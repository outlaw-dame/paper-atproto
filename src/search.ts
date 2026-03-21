import { pipeline } from '@xenova/transformers';
import { paperDB } from './db';

export class HybridSearch {
  private extractor: any;

  async init() {
    // Initialize the feature extraction pipeline for semantic search
    // Using a small, efficient model suitable for browser environments
    this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async indexPost(post: { id: string; uri: string; cid: string; author_did: string; content: string }) {
    const embedding = await this.generateEmbedding(post.content);
    const db = paperDB.getDB();

    await db.query(`
      INSERT INTO posts (id, uri, cid, author_did, content, embedding)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (uri) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding;
    `, [post.id, post.uri, post.cid, post.author_did, post.content, JSON.stringify(embedding)]);
  }

  async search(query: string, limit: number = 10) {
    const queryEmbedding = await this.generateEmbedding(query);
    const db = paperDB.getDB();

    // Hybrid Search using Reciprocal Rank Fusion (RRF) or weighted average
    // Here we use a weighted combination of Full-Text Search (BM25-like) and Semantic Similarity
    return await db.query(`
      WITH fts AS (
        SELECT id, ts_rank_cd(search_vector, to_tsquery('english', $1)) as fts_score
        FROM posts
        WHERE search_vector @@ to_tsquery('english', $1)
      ),
      semantic AS (
        SELECT id, 1 - (embedding <=> $2::vector) as semantic_score
        FROM posts
        ORDER BY embedding <=> $2::vector
        LIMIT $3 * 2
      )
      SELECT 
        p.*,
        COALESCE(fts.fts_score, 0) as fts_score,
        COALESCE(semantic.semantic_score, 0) as semantic_score,
        (COALESCE(fts.fts_score, 0) * 0.4 + COALESCE(semantic.semantic_score, 0) * 0.6) as hybrid_score
      FROM posts p
      LEFT JOIN fts ON p.id = fts.id
      LEFT JOIN semantic ON p.id = semantic.id
      WHERE fts.id IS NOT NULL OR semantic.id IS NOT NULL
      ORDER BY hybrid_score DESC
      LIMIT $3;
    `, [query.split(' ').join(' & '), JSON.stringify(queryEmbedding), limit]);
  }
}

export const hybridSearch = new HybridSearch();
