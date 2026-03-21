import { pipeline } from '@xenova/transformers';
import { paperDB } from './db';

/**
 * Hybrid Search Utility
 * Combines Full-Text Search (FTS) and Semantic Search using Reciprocal Rank Fusion (RRF).
 * Runs entirely in the browser using PGlite and Transformers.js.
 */

export class HybridSearch {
  private extractor: any;

  async init() {
    if (!this.extractor) {
      // Using a small, efficient model suitable for browser environments
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
  }

  /**
   * Generate a semantic embedding for a given text.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) await this.init();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Perform a hybrid search using Reciprocal Rank Fusion (RRF).
   * RRF combines the rankings from FTS and Semantic search without needing score normalization.
   */
  async search(query: string, limit: number = 20) {
    if (!this.extractor) await this.init();
    const pg = paperDB.getPG();
    const queryEmbedding = await this.generateEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    /**
     * RRF Algorithm: score = sum(1 / (k + rank))
     * k is a constant (usually 60) to mitigate the impact of low-ranked items.
     */
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

    return await pg.query(sql, [query, limit, vectorStr, k]);
  }

  /**
   * Search across both posts and feed items using hybrid search.
   */
  async searchAll(query: string, limit: number = 20) {
    if (!this.extractor) await this.init();
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

    return await pg.query(sql, [query, limit, vectorStr, k]);
  }
}

export const hybridSearch = new HybridSearch();
