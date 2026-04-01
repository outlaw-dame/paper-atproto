#!/usr/bin/env bash
# ─── dev-tunnel.sh ────────────────────────────────────────────────────────────
# Starts the full local dev stack and exposes it via a Cloudflare quick tunnel.
#
# Traffic flow:
#   Cloudflare tunnel → Vite dev server (:5180) → /api/* proxied to backend (:3011)
#
# Usage:
#   ./scripts/tunnel.sh          # fresh tunnel (new URL each run)
#   TUNNEL_PORT=5183 ./scripts/tunnel.sh  # use a different Vite port
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"
CF_LOG="/tmp/cf-tunnel-active.log"

VITE_PORT="${TUNNEL_PORT:-5180}"
BACKEND_PORT="${BACKEND_PORT:-3011}"

# ── Cleanup helper ────────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  echo "[tunnel] shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "[tunnel] done."
}
trap cleanup EXIT INT TERM

# ── Kill anything left on our target ports ────────────────────────────────────
free_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "[tunnel] freeing port $port (pids: $pids)"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.8
  fi
}
free_port "$VITE_PORT"
free_port "$BACKEND_PORT"

# ── Start backend ─────────────────────────────────────────────────────────────
echo "[tunnel] starting backend on :$BACKEND_PORT"
cd "$ROOT/server"
PORT="$BACKEND_PORT" npm run dev &
BACKEND_PID=$!
PIDS+=("$BACKEND_PID")
cd "$ROOT"

# Wait for the backend to be ready (up to 15 s)
echo "[tunnel] waiting for backend..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
    echo "[tunnel] backend ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[tunnel] ERROR: backend did not start in time" >&2
    exit 1
  fi
  sleep 0.5
done

# ── Start Vite dev server (no strictPort — avoids crash on env-change restarts) ──
echo "[tunnel] starting Vite on :$VITE_PORT"
VITE_DEV_PORT="$VITE_PORT" npm run dev &
VITE_PID=$!
PIDS+=("$VITE_PID")

# Wait for Vite to be ready (up to 15 s)
echo "[tunnel] waiting for Vite..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$VITE_PORT" >/dev/null 2>&1; then
    echo "[tunnel] Vite ready"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[tunnel] ERROR: Vite did not start in time" >&2
    exit 1
  fi
  sleep 0.5
done

# ── Start Cloudflare tunnel, capture URL ─────────────────────────────────────
echo ""
echo "[tunnel] starting Cloudflare tunnel → http://localhost:$VITE_PORT"
> "$CF_LOG"
cloudflared tunnel --url "http://localhost:$VITE_PORT" --logfile "$CF_LOG" &
CF_PID=$!
PIDS+=("$CF_PID")

# Wait for the tunnel URL to appear (up to 20 s)
echo "[tunnel] waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 40); do
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1 || true)
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo "[tunnel] ERROR: cloudflared exited unexpectedly" >&2
    exit 1
  fi
  sleep 0.5
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "[tunnel] ERROR: could not determine tunnel URL" >&2
  exit 1
fi

echo "[tunnel] tunnel URL: $TUNNEL_URL"

# ── Auto-update .env.local with the new tunnel URL ───────────────────────────
if [[ -f "$ENV_LOCAL" ]]; then
  # Replace any existing trycloudflare URLs
  sed -i '' \
    -e "s|https://[a-z0-9-]*\.trycloudflare\.com|$TUNNEL_URL|g" \
    "$ENV_LOCAL"
  echo "[tunnel] .env.local updated with $TUNNEL_URL"
else
  # Create a minimal .env.local if it doesn't exist
  cat > "$ENV_LOCAL" <<EOF
VITE_ATPROTO_OAUTH_CLIENT_ID=${TUNNEL_URL}/oauth/client-metadata.json
VITE_ATPROTO_HANDLE_RESOLVER=https://bsky.social
VITE_ATPROTO_OAUTH_SCOPE=atproto transition:generic
VITE_ATPROTO_OAUTH_CLIENT_NAME=Glimpse
VITE_ATPROTO_OAUTH_METADATA_ORIGIN=${TUNNEL_URL}
VITE_ATPROTO_OAUTH_REDIRECT_URIS=${TUNNEL_URL}/
VITE_OAUTH_DEBUG=1
EOF
  echo "[tunnel] .env.local created with $TUNNEL_URL"
fi

# Fully restart Vite so config/env-backed OAuth metadata picks up the new URL.
echo "[tunnel] restarting Vite with updated tunnel URL..."
kill "$VITE_PID" 2>/dev/null || true
wait "$VITE_PID" 2>/dev/null || true

VITE_DEV_PORT="$VITE_PORT" npm run dev &
VITE_PID=$!
PIDS+=("$VITE_PID")

echo "[tunnel] waiting for restarted Vite..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$VITE_PORT" >/dev/null 2>&1; then
    echo "[tunnel] Vite restarted"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "[tunnel] ERROR: restarted Vite did not come back in time" >&2
    exit 1
  fi
  sleep 0.5
done

echo ""
echo "[tunnel] ✓ Stack is up"
echo "[tunnel]   Public URL : $TUNNEL_URL"
echo "[tunnel]   Vite       : http://localhost:$VITE_PORT"
echo "[tunnel]   Backend    : http://localhost:$BACKEND_PORT"
echo "[tunnel]   /api/*     : proxied by Vite to backend"
echo "[tunnel]   .env.local : updated automatically"
echo ""
echo "[tunnel] Ctrl-C to stop everything."

# Keep running until the user kills the script
wait "$CF_PID"
