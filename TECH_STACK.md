# Technology Stack

**paper-atproto** (Product Name: *Glimpse*) is a local-first SPA built for performance and privacy.

## Frontend Runtime

*   **Framework:** React 19 + Vite 8
*   **Language:** TypeScript 5.9
*   **Build Tool:** Vite

## Data & State

*   **Local Database:** PGlite (Postgres WASM) with `pgvector`
    *   Persistence: IndexedDB / OPFS
*   **State Management:**
    *   **Server State:** TanStack Query (v5)
    *   **Client State:** Zustand (v5)
*   **ORM:** Drizzle ORM

## Inference & Intelligence

*   **Engine:** Transformers.js (v2)
*   **Execution:** Web Worker (off-main-thread)
*   **Models:** `Xenova/all-MiniLM-L6-v2` (Embeddings)

## UI & Interaction

*   **Styling:** Tailwind CSS 4
*   **Components:** Konsta UI (iOS theme)
*   **Motion:** Framer Motion
*   **Gestures:** @use-gesture/react
