# Paper-ATProto

A local-first ATProto social reader inspired by Facebook Paper, Neeva Gist, and Apple HIG.

## Stack

*   **Core:** React 19, Vite 8, TypeScript
*   **State:** TanStack Query, Zustand
*   **Data:** PGlite (Postgres WASM) + pgvector
*   **Inference:** Transformers.js (in Web Worker)
*   **Network:** ATProto via `@atproto/api`
*   **UI:** Tailwind CSS, Konsta UI, Framer Motion
*   **Composer Guidance Layer:** Shared authoring guidance for `ComposeSheet` and `PromptComposer`, built from staged local heuristics + opt-in worker-hosted classifiers + local abuse scoring + selective server-side guidance writing

## Core Architecture

The app now runs as one connected AI system with layered execution rather than a few disconnected model features:

1. **Deterministic substrate**
   Resolves ATProto objects, shapes thread/search context, and applies safety-aware heuristics before any remote model is invoked.

2. **Decision layer**
   Uses bounded algorithms for contributor selection, thread-change detection, entity centrality, stance coverage, and comment diversity.

3. **Evidence enrichment**
   Adds verification, translation, and multimodal gating only when the thread actually warrants it.

4. **Model execution lanes**
   Uses server-side writers and multimodal analysis for the default path, with premium provider-routed Gemini/OpenAI interpolation for entitled users and explicit browser-runtime policies for larger local models.

5. **Session/control plane**
   Streams AI session state, presence, and replay lanes through protected `/api/ai/sessions/*` routes.

Thread freshness is still bounded rather than truly live: Story mode rehydrates on a polling budget, and the app now reuses existing writer outputs when no meaningful thread change is detected instead of re-running the full model stack on every refresh.

The canonical architecture and execution flow now live in [ARCHITECTURE.md](./ARCHITECTURE.md).

Browser ML safety policy and model staging profiles are documented in [docs/browser-ml-safety.md](./docs/browser-ml-safety.md).

## Getting Started

1. **Install and setup:**
```bash
# Install workspace dependencies
pnpm install

# Create the root app env file for OAuth, Klipy, and verify-server settings
cp .env.example .env

# Create the verify-server env file
cd server
npm install
cp .env.example .env
cd ..
```

2. **Run the project:**
You need to run the app, the verify-server, and an HTTPS tunnel (required for full permissions) in separate terminals:

*   **Terminal 1 (App):** `pnpm dev` (Runs on `http://localhost:5180`)
*   **Terminal 2 (Server):** `npm --prefix ./server run dev`
*   **Terminal 3 (Tunnel):** An HTTPS tunnel is required for full ATProto permissions. **Cloudflare Tunnel** is recommended, but you can also use `ngrok`, `zrok`, or `localtunnel`:
    *   *Recommended:* `npx cloudflared tunnel --url http://127.0.0.1:5180`
    *   *Alternative (ngrok):* `ngrok http 5180`

3. **Access the app:**
Copy the HTTPS URL from your tunnel output (for example, `https://...trycloudflare.com`). In the root `.env`, set:

```bash
VITE_ATPROTO_OAUTH_CLIENT_ID=https://<your-tunnel-host>/oauth/client-metadata.json
VITE_ATPROTO_OAUTH_METADATA_ORIGIN=https://<your-tunnel-host>
VITE_ATPROTO_OAUTH_REDIRECT_URIS=https://<your-tunnel-host>/
```

For GIF search, set `VITE_KLIPY_API_KEY` in the root `.env` to a valid Klipy API key (get one at https://partner.klipy.com/api-keys).

Open the tunnel URL and sign in with your Bluesky handle through OAuth.

### Browser ML defaults

Browser model loading is conservative by default:

* Automatic composer browser ML is disabled unless `VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML=1`.
* Browser ML smoke checks are disabled unless `VITE_ENABLE_BROWSER_ML_SMOKE=1`.
* `pnpm models:download-browser` installs the minimal `core` profile only: embeddings.
* Large local browser model experiments require explicit staging, for example `pnpm models:download-browser -- --profile premium`.

Keep these disabled for normal development unless intentionally testing local ONNX/WebGPU behavior.

### Optional platform env

The platform layer is wired but remains opt-in and non-authoritative.

* `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` enables Web Push subscription setup.
* `VITE_PUSH_SUBSCRIPTION_ENDPOINT` optionally overrides the default `/api/push/subscription` backend route.
* `VITE_CLOUDKIT_CONTAINER_ID` and `VITE_CLOUDKIT_API_TOKEN` enable optional CloudKit mirroring.
* `VITE_CLOUDKIT_ENVIRONMENT` optionally overrides the default CloudKit environment.
* `VITE_CLOUDKIT_JS_SRC` optionally overrides the CloudKit JS script URL. Only same-origin or Apple-hosted HTTPS URLs are accepted.
* `VITE_ENABLE_DRAFT_RECOVERY_MIRROR=true` enables encrypted CloudKit draft recovery mirroring.

Push prompting stays explicit. CloudKit never blocks boot and does not become the source of truth for auth or session state.
When enabled, the app now lazy-loads CloudKit JS on demand with bounded retry, full jitter, strict script URL validation, and same-origin or Apple CDN allowlisting.

OAuth setup notes:

*   For local development, OAuth loopback mode works without a hosted `client_id`.
*   Localhost loopback mode intentionally requests only the base `atproto` scope when `VITE_ATPROTO_OAUTH_CLIENT_ID` is unset. Use an HTTPS origin with hosted client metadata for full Bluesky AppView permissions.
*   For full Bluesky app permissions, use a secure hosted metadata URL (HTTPS). Loopback-only OAuth can be permission-limited.
*   For secure origins, set `VITE_ATPROTO_OAUTH_CLIENT_ID` to `<origin>/oauth/client-metadata.json` or another hosted client metadata URL.
*   Vite dev server now serves dynamic metadata at `/oauth/client-metadata.json` with strict sanitization and no-store caching.
*   A starter static metadata template is still included at `public/oauth/client-metadata.json` for fully static hosting scenarios.
*   Hardened client config validation is enabled: invalid or insecure OAuth URLs are ignored and the app falls back to safe defaults.
*   Auth identifiers are sanitized before sign-in and raw provider/network errors are not shown directly to users.
*   Runtime guardrails now block browser OAuth on non-HTTPS origins and block loopback-only mode outside localhost so broken deploys fail closed.

### Production OAuth checklist

1. Serve the app from an HTTPS origin (deployed domain or tunnel).
2. Ensure metadata is reachable at `<origin>/oauth/client-metadata.json`.
3. If using dynamic metadata in dev, set:
    - `VITE_ATPROTO_OAUTH_CLIENT_ID=<origin>/oauth/client-metadata.json`
    - `VITE_ATPROTO_OAUTH_METADATA_ORIGIN=<origin>`
    - `VITE_ATPROTO_OAUTH_REDIRECT_URIS=<origin>/` (comma-separated if you support more than one redirect URI)
4. Keep the default `VITE_ATPROTO_OAUTH_SCOPE` from `.env.example` unless your provider requires otherwise. It includes `atproto`, `transition:generic`, and the Bluesky AppView RPC scopes used by timeline/profile calls.
5. If metadata is hosted on a different origin, set `VITE_ATPROTO_OAUTH_CLIENT_ID` explicitly to that hosted metadata URL.
6. Confirm consent/technical details include required app permissions (not only `atproto`).
7. Run sign-in + OTP + consent + callback smoke tests on the final origin.
8. Use HTTPS everywhere except intentional localhost loopback development.
9. Validate cancel and retry behavior to ensure no stale callback/session state remains.

### Localhost permissions troubleshooting

If login succeeds but app data loads fail with permissions errors:

1. Start app on a public HTTPS URL (for example, a tunnel to local dev server).
2. Open the app through that HTTPS URL (not `http://127.0.0.1:*`).
3. Re-run OAuth and verify technical details on consent screen include required app permissions.
4. If still blocked, set explicit metadata values:
    - `VITE_ATPROTO_OAUTH_CLIENT_ID=https://<your-host>/oauth/client-metadata.json`
    - `VITE_ATPROTO_OAUTH_METADATA_ORIGIN=https://<your-host>`
    - `VITE_ATPROTO_OAUTH_REDIRECT_URIS=https://<your-host>/`

## External Entity Linking (Enabled)

The verification layer supports external entity linking/matching and is now configured to use **DBpedia Spotlight** by default on the server side.

### 1. Start the Verify Server

```bash
cd server
npm install
npm run dev
```

The verify server now supports secure response compression negotiation:

* Uses `Accept-Encoding` with weighted q-values.
* Prefers `zstd` when supported by client/runtime, otherwise falls back to `gzip`.
* Skips binary media and already-compressed payloads.
* Skips responses with `Cache-Control: no-transform`.
* Applies a minimum/maximum payload window to avoid CPU abuse.

Compression env keys (`server/.env`):

* `COMPRESSION_ENABLED`
* `COMPRESSION_MIN_BYTES`
* `COMPRESSION_MAX_BYTES`
* `COMPRESSION_GZIP_LEVEL`
* `COMPRESSION_ZSTD_LEVEL`

Rate limiting env keys (`server/.env`):

* `RATE_LIMIT_REDIS_URL` (optional; enables shared Redis-backed limiting)
* `RATE_LIMIT_REDIS_PREFIX` (optional; default `paper:ratelimit`)
* `RATE_LIMIT_REDIS_FAIL_CLOSED` (optional; default `false`; when `true`, requests fail with `503` if Redis limiter is unavailable)
* `RATE_LIMIT_TRUST_PROXY` (optional; default `false`; only trust proxy IP header when enabled)
* `RATE_LIMIT_TRUSTED_IP_HEADER` (optional; default `cf-connecting-ip`; header used when proxy trust is enabled)

Operational details and failover behavior are documented in `docs/rate-limit-runbook.md`.

The server reads `server/.env.example` keys:

* `VERIFY_ENTITY_LINKING_PROVIDER` (`dbpedia` | `wikidata` | `hybrid` | `rel` | `heuristic`)
* `VERIFY_ENTITY_LINKING_ENDPOINT`
* `VERIFY_WIKIDATA_ENDPOINT`
* `VERIFY_ENTITY_LINKING_TIMEOUT_MS`
* `VERIFY_ENTITY_LINKING_API_KEY`
* `GOOGLE_SAFE_BROWSING_API_KEY` (optional, enables URL reputation checks)

Default mode is `dbpedia` using `https://api.dbpedia-spotlight.org/en/annotate`.

### 2. Point the Client to the Verify Server

Set root env values (see `.env.example`):

* `VITE_GLYMPSE_VERIFY_BASE_URL=http://localhost:3001/verification`
* `VITE_GLYMPSE_VERIFY_TIMEOUT_MS=6000`

Then run the app:

```bash
pnpm dev
```

Production builds also generate precompressed static files (`.gz` and `.zst`) for compressible assets. Ensure your CDN or edge server is configured to:

* Negotiate from `Accept-Encoding` and serve matching precompressed variants.
* Return `Content-Encoding` and `Vary: Accept-Encoding` correctly.
* Preserve original MIME type when serving `.gz`/`.zst` files.

Detailed edge/CDN examples are available in `docs/compression-deployment.md`.
You can run local size/latency benchmarks with `npm run benchmark:compression`.

## Cloudflare Workers AI composer classifier

Cloudflare Workers AI is wired for the composer classifier only when the app is running through Cloudflare Pages Functions. The Pages Function at `/api/llm/analyze/composer-classifier` uses a Workers AI binding named `AI` and calls `env.AI.run(...)`. The Node verify-server composer classifier remains a deterministic fallback for non-Cloudflare/local server development.

Setup for deployed Cloudflare Pages:

1. Ensure `wrangler.toml` contains the Workers AI binding:

```toml
[ai]
binding = "AI"
```

2. In the Cloudflare dashboard, open the Pages project, go to the target environment settings, add a **Workers AI** binding named `AI`, and redeploy.

Local Cloudflare Pages smoke test:

```bash
pnpm run build:cf
pnpm run cf:dev
curl -X POST http://127.0.0.1:8788/api/llm/analyze/composer-classifier \
  -H 'content-type: application/json' \
  --data '{"mode":"post","draftText":"Thanks for the source, but I think this needs more context."}'
```

A successful Workers AI response includes:

```json
{
  "provider": "cloudflare-workers-ai",
  "model": "@cf/huggingface/distilbert-sst-2-int8"
}
```

If the `AI` binding is missing, the Pages Function returns `503` with `WORKERS_AI_UNAVAILABLE`. The client still fails soft and preserves immediate local composer guidance.

REST API note: Cloudflare's REST path is for non-Worker callers and requires a Cloudflare Account ID plus a Workers AI API token. Do not expose those values to the browser.

## Google Gemini Integration

The server already uses `@google/genai` for three Gemini-backed lanes:

* verification grounding
* premium deep interpolation
* composer guidance

Setup:

```bash
cd server
cp .env.example .env
```

Then set the Gemini env values you want:

```bash
GEMINI_API_KEY=your-google-api-key
VERIFY_GEMINI_GROUNDING_ENABLED=true
PREMIUM_AI_ENABLED=true
GEMINI_COMPOSER_ENABLED=true

# Set any Google model string your account can access.
GEMINI_GROUNDING_MODEL=gemini-2.5-flash
GEMINI_DEEP_INTERPOLATOR_MODEL=gemini-2.5-flash
GEMINI_COMPOSER_MODEL=gemini-2.5-flash
```

If you specifically want to trial a newer Google preview model, set the lane you want to route to that model, for example:

```bash
GEMINI_DEEP_INTERPOLATOR_MODEL=gemini-3.1-pro-preview
```

That maps onto the same `GoogleGenAI` SDK path the server already uses internally, equivalent to:

```ts
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

Notes:

* Keep Gemini on the server side; do not expose the API key to the browser.
* Model availability changes over time, so use a model string your Google account/project can actually access.
* Each Gemini lane is independently configurable, so you can test a preview model in one path without moving the others.

### 3. Optional: Switch to REL

In `server/.env` set:

```bash
VERIFY_ENTITY_LINKING_PROVIDER=rel
VERIFY_ENTITY_LINKING_ENDPOINT=http://localhost:5555
```

Start REL locally with Docker:

```bash
docker pull informagi/rel
docker run \
    -p 5555:5555 \
    --rm -it informagi/rel \
    python -m REL.server --bind 0.0.0.0 --port 5555 /workspace/data wiki_2019
```

If you do not have REL data mounted yet, follow REL docs to download and mount
the `generic` and `wiki_2019` data directories into `/workspace/data`.

### 4. Verify Active Provider at Runtime

Health check:

```bash
curl http://localhost:3001/health
```

Verification provider status:

```bash
curl http://localhost:3001/api/verify/status
```

The status endpoint reports active entity-linking provider, endpoint, timeout,
and whether external linking is currently enabled.

If external calls fail or time out, the pipeline safely falls back to deterministic heuristics.

## Safe Browsing Integration

Paper now integrates Google Safe Browsing Lookup API v4 through the local verify-server.

What it does:

* Checks external URLs via `POST /api/safety/url-check` before rich link previews are shown.
* Blocks opening links from hover previews when the URL is flagged unsafe.
* Composer preview warns when a link is flagged and skips creating an external embed card for that URL.

Configure:

1. Set `GOOGLE_SAFE_BROWSING_API_KEY` in `server/.env`.
2. Start the server (`npm --prefix ./server run dev`) and app (`pnpm dev`).
3. Ensure `VITE_GLYMPSE_VERIFY_BASE_URL` points to the verify-server base (default local fallback is `http://localhost:3001`).

## Current Status

🚧 **Active prototype with a connected interpretation pipeline**

### Implemented
* App Password Auth plus hardened OAuth/browser-origin safeguards
* Verified thread pipeline with confidence, verification, and summary-mode shaping
* Phase 1 decision algorithms wired into production code paths
* Hybrid search with off-thread embeddings and local vector storage
* Story mode, multimodal gating, premium deep interpolation, and AI session transport

### In Progress
* SetFit-backed replacement for remaining heuristic scoring paths
* Story-clustering and deeper discovery algorithms from the roadmap
* Safer local browser generation runtime expansion, especially multimodal
* Continued test hardening and rollout validation
