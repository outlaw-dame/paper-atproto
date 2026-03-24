import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

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

      -- Create feeds table
      CREATE TABLE IF NOT EXISTS feeds (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT,
        description TEXT,
        type TEXT NOT NULL,
        last_synced_at TIMESTAMP WITH TIME ZONE,
        category TEXT
      );

      -- Create feed_items table
      CREATE TABLE IF NOT EXISTS feed_items (
        id TEXT PRIMARY KEY,
        feed_id UUID REFERENCES feeds(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT,
        link TEXT NOT NULL,
        pub_date TIMESTAMP WITH TIME ZONE,
        author TEXT,
        enclosure_url TEXT,
        enclosure_type TEXT,
        embedding vector(384),
        search_vector tsvector
      );

      -- Create index for full-text search (GIN)
      CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
      CREATE INDEX IF NOT EXISTS idx_feed_items_search_vector ON feed_items USING GIN(search_vector);
      
      -- Create index for semantic search (HNSW)
      -- Using cosine similarity for better semantic matching
      CREATE INDEX IF NOT EXISTS idx_posts_embedding ON posts USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
      CREATE INDEX IF NOT EXISTS idx_feed_items_embedding ON feed_items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
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

      -- Trigger for feed_items
      CREATE OR REPLACE FUNCTION feed_items_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector := to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.content, ''));
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_feed_items_search_vector_update ON feed_items;
      CREATE TRIGGER trg_feed_items_search_vector_update
      BEFORE INSERT OR UPDATE ON feed_items
      FOR EACH ROW EXECUTE FUNCTION feed_items_search_vector_update();
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
