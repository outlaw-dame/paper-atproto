import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

export class PaperDB {
  private db: PGlite;

  constructor() {
    // Initialize PGlite with the vector extension
    this.db = new PGlite('idb://paper-atproto-db', {
      extensions: {
        vector,
      },
    });
  }

  async init() {
    // Create tables for ATProto records with hybrid search support
    await this.db.exec(`
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Create posts table
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        uri TEXT UNIQUE NOT NULL,
        cid TEXT NOT NULL,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        -- Full-text search vector
        search_vector tsvector,
        
        -- Semantic search vector (384 dimensions for typical small models like all-MiniLM-L6-v2)
        embedding vector(384)
      );

      -- Create index for full-text search
      CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
      
      -- Create index for semantic search (HNSW for performance)
      CREATE INDEX IF NOT EXISTS idx_posts_embedding ON posts USING hnsw (embedding vector_cosine_ops);
    `);

    // Trigger to update search_vector on insert/update
    await this.db.exec(`
      CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector := to_tsvector('english', new.content);
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_posts_search_vector_update ON posts;
      CREATE TRIGGER trg_posts_search_vector_update
      BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();
    `);
  }

  getDB() {
    return this.db;
  }
}

export const paperDB = new PaperDB();
