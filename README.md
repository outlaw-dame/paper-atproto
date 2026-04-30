# Paper-ATProto

A local-first ATProto social reader inspired by Facebook Paper, Neeva Gist, and Apple HIG.

## Stack

*   **Core:** React 19, Vite 8, TypeScript
*   **State:** TanStack Query, Zustand
*   **Data:** PGlite (Postgres WASM) + pgvector
*   **Inference:** Transformers.js (in Web Worker)
*   **Network:** ATProto via `@atproto/api`
*   **UI:** Tailwind CSS, Konsta UI, Framer Motion
*   **Composer Guidance Layer:** Shared authoring guidance for `ComposeSheet` and `PromptComposer`, built from staged local heuristics + worker-hosted sentiment/emotion/targeted-tone models + local abuse scoring + selective server-side guidance writing

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

## Getting Started

1. **Install and Setup:**
```bash
# Install dependencies
pnpm install

# Setup server environment
cd server && npm install
cp .env.example .env
cd ..
```

2. **Run the Project:**
You need to run the app, the verify-server, and an HTTPS tunnel (required for full permissions) in separate terminals:

*   **Terminal 1 (App):** `pnpm dev` (Runs on `http://localhost:5180`)
*   **Terminal 2 (Server):** `npm --prefix ./server run dev`
*   **Terminal 3 (Tunnel):** An HTTPS tunnel is required for full ATProto permissions. **Cloudflare Tunnel** is recommended, but you can also use `ngrok`, `zrok`, or `localtunnel`:
    *   *Recommended:* `npx cloudflared tunnel --url http://127.0.0.1:5180`
    *   *Alternative (ngrok):* `ngrok http 5180`

3. **Access the App:**
Copy the HTTPS URL from your tunnel output (e.g., `https://...trycloudflare.com`), update your root `.env` with it, and open it in your browser.

For GIF search, create a `.env` file from `.env.example` and set `VITE_KLIPY_API_KEY` to a valid Klipy API key (get one at https://partner.klipy.com/api-keys).

Open the tunnel URL and sign in with your Bluesky handle through OAuth.

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
*   For full Bluesky app permissions, use a secure hosted metadata URL (HTTPS). Loopback-only OAuth can be permission-limited.
*   For secure origins, the app now auto-derives `client_id` as `<origin>/oauth/client-metadata.json` when `VITE_ATPROTO_OAUTH_CLIENT_ID` is unset.
*   Vite dev server now serves dynamic metadata at `/oauth/client-metadata.json` with strict sanitization and no-store caching.
*   A starter static metadata template is still included at `public/oauth/client-metadata.json` for fully static hosting scenarios.
*   Hardened client config validation is enabled: invalid or insecure OAuth URLs are ignored and the app falls back to safe defaults.
*   Auth identifiers are sanitized before sign-in and raw provider/network errors are not shown directly to users.
*   Runtime guardrails now block browser OAuth on non-HTTPS origins and block loopback-only mode outside localhost so broken deploys fail closed.

### Production OAuth checklist

1. Serve the app from an HTTPS origin (deployed domain or tunnel).
2. Ensure metadata is reachable at `<origin>/oauth/client-metadata.json`.
3. If using dynamic metadata in dev, optionally set:
    - `VITE_ATPROTO_OAUTH_METADATA_ORIGIN`
    - `VITE_ATPROTO_OAUTH_REDIRECT_URIS` (comma-separated)
4. Keep `VITE_ATPROTO_OAUTH_SCOPE=atproto transition:generic` unless your provider requires otherwise.
5. If metadata is hosted on a different origin, set `VITE_ATPROTO_OAUTH_CLIENT_ID` explicitly.
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

## Google Fact Check Integration

Google Fact Check Tools sits in the conversation OS verification lane, not the
URL safety lane.

What it does:

* Calls Google Fact Check Tools `claims:search` from `POST /api/verify/fact-check` for extracted text claims.
* Calls Google Fact Check Tools `claims:imageSearch` for public media URLs after URL sanitization and Safe Browsing preflight.
* Feeds matches into `knownFactCheckMatch`, fact-check chips, factual confidence, and cited review URLs.
* Sharpens the session-level interpretive stack through evidence adequacy, source integrity support, contradiction handling, and structured confidence explanations.

Configure:

1. Set `GOOGLE_FACT_CHECK_API_KEY` in `server/.env`.
2. Ensure `VITE_GLYMPSE_VERIFY_BASE_URL` points to the verify-server base.
3. Check `curl http://localhost:3001/api/verify/status` for the `factCheck` provider block.

## Safe Browsing Integration

Paper now integrates Google Safe Browsing Lookup API v4 through the local verify-server.

What it does:

* Checks external URLs via `POST /api/safety/url-check` before rich link previews are shown.
* Blocks opening links from hover previews when the URL is flagged unsafe.
* Composer preview warns when a link is flagged and skips creating an external embed card for that URL.
* Preflights remote media URLs before they are sent to verification providers.

What it does not do:

* It does not decide whether a claim is true or false.
* It does not replace Google Fact Check Tools, Gemini grounding, or source corroboration.

Configure:

1. Set `GOOGLE_SAFE_BROWSING_API_KEY` in `server/.env`.
2. Start the server (`npm --prefix ./server run dev`) and app (`pnpm dev`).
3. Ensure `VITE_GLYMPSE_VERIFY_BASE_URL` points to the verify-server base (default local fallback is `http://localhost:3001`).

## Interpretive Confidence and Discovery Coverage

The canonical interpretive confidence layer lives in `src/conversation/interpretive/*`.
It now emits a schema-v2 structured explanation with bounded factor
contributions and uses verification outputs, including Google Fact Check, to
refine evidence/source/contradiction factors.

Discovery coverage-gap analysis lives in `src/conversation/discovery/coverageGap.ts`
and feeds presentation mode policy in `src/conversation/projections/discoveryModePolicy.ts`.
It fails soft to a zero-gap signal and does not create a second thread-confidence model.

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
