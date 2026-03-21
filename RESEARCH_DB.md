# Research: Local-First Hybrid Search Databases

To support the "modern Facebook Paper" vision on ATProto, the application requires a performant local-first database capable of **Hybrid Search** (Full-Text + Semantic).

## Comparison of Candidates

| Feature | PGlite (Postgres WASM) | Orama | RxDB |
| :--- | :--- | :--- | :--- |
| **Full-Text Search** | Native (tsvector/tsquery) | Highly Optimized (BM25) | Via Plugins |
| **Semantic Search** | `pgvector` extension | Native Vector Support | Via Transformers.js |
| **Hybrid Search** | SQL-based (RRF possible) | Native Hybrid API | Manual Integration |
| **Persistence** | IndexedDB / OPFS | Manual / Plugin | IndexedDB / OPFS / SQLite |
| **Ecosystem** | Standard SQL / Postgres | JS-native / Search-focused | NoSQL / Sync-focused |

## Recommendation: PGlite

**PGlite** is the recommended choice for the following reasons:

1.  **Native Hybrid Capabilities:** It supports both traditional Postgres full-text search and the `pgvector` extension for semantic search. This allows for complex hybrid queries using standard SQL.
2.  **Relational Power:** Social apps like Facebook Paper involve complex relationships (users, posts, follows, likes). A relational database is better suited for these than a pure search engine like Orama.
3.  **Local-First Sync:** Being Postgres-based, it aligns well with future sync strategies (e.g., ElectricSQL) and the structured nature of ATProto records.
4.  **Performance:** Running as a WASM build of Postgres, it offers high performance with persistence to IndexedDB or the newer, faster Origin Private File System (OPFS).

## Implementation Strategy

*   **Database:** PGlite with `pgvector` extension.
*   **Embeddings:** Use `transformers.js` to generate text embeddings locally in the browser.
*   **Search:** Combine `tsvector` scores with `pgvector` cosine similarity using Reciprocal Rank Fusion (RRF) or simple weighted averaging in SQL.
