# Paper-ATProto

A local-first ATProto social reader inspired by Facebook Paper, Neeva Gist, and Apple HIG.

## Stack

*   **Core:** React 19, Vite 8, TypeScript
*   **State:** TanStack Query, Zustand
*   **Data:** PGlite (Postgres WASM) + pgvector
*   **Inference:** Transformers.js (in Web Worker)
*   **Network:** ATProto via `@atproto/api`
*   **UI:** Tailwind CSS, Konsta UI, Framer Motion

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

Open `http://localhost:5173` and login with a Bluesky handle and **App Password**.

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