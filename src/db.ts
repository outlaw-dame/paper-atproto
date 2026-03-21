import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema';

/**
 * Database Utility using PGlite and Drizzle ORM.
 * Persists to IndexedDB for local-first reliability.
 */

export class PaperDB {
  private pg: PGlite;
  private db: any;

  constructor() {
    this.pg = new PGlite('idb://paper-atproto-db', {
      extensions: {
        vector,
      },
    });
    // Initialize Drizzle with PGlite
    this.db = drizzle(this.pg, { schema });
  }

  async init() {
    // Create tables for ATProto records with hybrid search support
    await this.pg.exec(`
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;

      -- Create posts table
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        search_vector tsvector,
        embedding vector(384),
        embed TEXT
      );

      -- Create entities table for linking
      CREATE TABLE IF NOT EXISTS entities (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        wikidata_id TEXT,
        score TEXT
      );

      -- Create index for full-text search
      CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
      
      -- Create index for semantic search (HNSW for performance)
      CREATE INDEX IF NOT EXISTS idx_posts_embedding ON posts USING hnsw (embedding vector_cosine_ops);
    `);

    // Trigger to update search_vector on insert/update
    await this.pg.exec(`
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

  getPG() {
    return this.pg;
  }
}

export const paperDB = new PaperDB();
