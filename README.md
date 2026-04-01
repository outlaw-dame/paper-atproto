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

The app uses a **Dual Pipeline** architecture for content processing:

1.  **Pipeline A (Story Search):**
    *   **Deterministic Layer:** Resolves AT URIs, facets, and labels synchronously.
    *   **Inference Layer:** Generates embeddings off-thread using `all-MiniLM-L6-v2`.
    *   **Storage:** Persists to local PGlite with vector search.

2.  **Pipeline B (Conversation Interpolation):**
    *   **Rolling State:** Scores threads for "usefulness" (clarifying, new info, counterpoint).
    *   **Scoring:** Currently uses heuristics; planned migration to SetFit classifier.

## Getting Started

```bash
pnpm install
pnpm dev
```

Run the auth/retry hardening checks with:

```bash
pnpm test
```

For GIF search, create a `.env` file from `.env.example` and set `VITE_KLIPY_API_KEY` to a valid Klipy API key (get one at https://partner.klipy.com/api-keys).

Open `http://localhost:5173` and sign in with your Bluesky handle through OAuth.

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

🚧 **Active Prototype / Refactoring**

### Implemented
*   App Password Auth (`AtpContext` + `sessionStore`)
*   Feed Sync with off-thread embeddings
*   Hybrid Search (FTS + Vector)
*   Story Mode UI (5-card layout)

### In Progress
*   Refactoring sync pipeline
*   Migrating thread scoring to SetFit
*   Adding unit tests
*   OAuth protocol compliance planning (see `OAUTH_COMPLIANCE_RESEARCH.md`)
