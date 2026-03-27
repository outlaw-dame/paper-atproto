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

For GIF search, create a `.env` file from `.env.example` and set `VITE_TENOR_API_KEY` to a valid Tenor API key.

Open `http://localhost:5173` and login with a Bluesky handle and **App Password**.

## External Entity Linking (Enabled)

The verification layer supports external entity linking/matching and is now configured to use **DBpedia Spotlight** by default on the server side.

### 1. Start the Verify Server

```bash
cd server
npm install
npm run dev
```

The server reads `server/.env.example` keys:

* `VERIFY_ENTITY_LINKING_PROVIDER` (`dbpedia` | `rel` | `heuristic`)
* `VERIFY_ENTITY_LINKING_ENDPOINT`
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
