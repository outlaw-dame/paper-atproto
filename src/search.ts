// ─── Hybrid Search ────────────────────────────────────────────────────────
// Combines Full-Text Search (FTS) and Semantic Search using Reciprocal Rank
// Fusion (RRF). Runs entirely in the browser using PGlite + pgvector.
//
// Embeddings are generated via the inference worker (off main thread).
// This module no longer imports from @xenova/transformers directly.

import { paperDB } from './db';
import { inferenceClient } from './workers/InferenceClient';

export class HybridSearch {
  /**
   * Generate a semantic embedding for a given text via the inference worker.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    return inferenceClient.embed(text);
  }

  /**
   * Perform a hybrid search using Reciprocal Rank Fusion (RRF).
   * RRF score = sum(1 / (k + rank)) across FTS and semantic rankings.
   */
  async search(query: string, limit = 20) {
    const pg = paperDB.getPG();
    const queryEmbedding = await this.generateEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;

    const sql = `
      WITH fts_results AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $1)) DESC) as rank
        FROM posts
        WHERE search_vector @@ plainto_tsquery('english', $1)
        LIMIT $2 * 2
      ),
      semantic_results AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
        FROM posts
        WHERE embedding IS NOT NULL
        LIMIT $2 * 2
      )
      SELECT
        p.*,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) as rrf_score
      FROM posts p
      LEFT JOIN fts_results f ON p.id = f.id
      LEFT JOIN semantic_results s ON p.id = s.id
      WHERE f.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `;

    return pg.query(sql, [query, limit, vectorStr, k]);
  }

  /**
   * Search across both posts and feed items using hybrid search.
   */
  async searchAll(query: string, limit = 20) {
    const pg = paperDB.getPG();
    const queryEmbedding = await this.generateEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;

    const sql = `
      WITH combined_items AS (
        SELECT id, content as text, 'post' as type FROM posts
        UNION ALL
        SELECT id, title || ' ' || coalesce(content, '') as text, 'feed_item' as type FROM feed_items
      ),
      fts_results AS (
        SELECT id, type, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) DESC) as rank
        FROM combined_items
        WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
        LIMIT $2 * 2
      ),
      semantic_results AS (
        SELECT id, 'post' as type, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
        FROM posts WHERE embedding IS NOT NULL
        UNION ALL
        SELECT id, 'feed_item' as type, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
        FROM feed_items WHERE embedding IS NOT NULL
        LIMIT $2 * 2
      )
      SELECT
        ci.id,
        ci.text as content,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) as rrf_score,
        ci.type as item_type
      FROM combined_items ci
      LEFT JOIN fts_results f ON ci.id = f.id AND ci.type = f.type
      LEFT JOIN semantic_results s ON ci.id = s.id AND ci.type = s.type
      WHERE f.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `;

    return pg.query(sql, [query, limit, vectorStr, k]);
  }
}

export const hybridSearch = new HybridSearch();
