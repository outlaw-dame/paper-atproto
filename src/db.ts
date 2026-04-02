import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  createPaperDbClient,
  type PaperDbClient,
  type PaperDbRuntimeInfo,
} from './db/runtime';
import * as schema from './schema';

/**
 * Database utility using PGlite and Drizzle ORM.
 * Prefers a worker-backed IndexedDB runtime in capable browsers and falls back
 * to an in-thread client when needed.
 */

export class PaperDB {
  private pg: PaperDbClient | null = null;
  private db: any = null;
  private runtimeInfo: PaperDbRuntimeInfo | null = null;
  private initPromise: Promise<void> | null = null;

  private requirePG(): PaperDbClient {
    if (!this.pg) {
      throw new Error('PaperDB accessed before init() completed');
    }

    return this.pg;
  }

  private requireDB() {
    if (!this.db) {
      throw new Error('PaperDB accessed before init() completed');
    }

    return this.db;
  }

  private async initialize(): Promise<void> {
    const { client, runtime } = await createPaperDbClient();
    const db = drizzle(client as unknown as PGlite, { schema });

    try {
      // Create tables for ATProto records with hybrid search support
      await client.exec(`
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

      -- Add media signal columns for better ranking (backward compatible)
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS has_images INTEGER DEFAULT 0;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS has_video INTEGER DEFAULT 0;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS has_link INTEGER DEFAULT 0;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_alt_text TEXT;

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
        transcript_url TEXT,
        chapters_url TEXT,
        value_config JSONB,
        embedding vector(384),
        search_vector tsvector
      );

      -- Backfill Podcasting 2.0 columns for existing installations
      ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS transcript_url TEXT;
      ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS chapters_url TEXT;
      ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS value_config JSONB;

      -- Create index for full-text search (GIN)
      CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
      CREATE INDEX IF NOT EXISTS idx_feed_items_search_vector ON feed_items USING GIN(search_vector);

      -- Create indexes for hot feed/search paths and foreign-key maintenance.
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_post_id ON entities (post_id);
      CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id_pub_date ON feed_items (feed_id, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items (pub_date DESC);
    `);

      // Trigger to update search_vector on insert/update
      await client.exec(`
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

      this.pg = client;
      this.db = db;
      this.runtimeInfo = runtime;
    } catch (error) {
      this.pg = null;
      this.db = null;
      this.runtimeInfo = null;
      await client.close().catch(() => {});
      throw error;
    }
  }

  async init() {
    if (this.pg && this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.initialize().finally(() => {
        this.initPromise = null;
      });
    }

    await this.initPromise;
  }

  // Build HNSW vector indexes separately — deferred after startup so the memory
  // spike from index construction (pgvector loads the full embedding column into
  // the WASM heap) doesn't hit during first paint or on low-memory mobile devices.
  async buildIndexes() {
    await this.init();
    await this.requirePG().exec(`
      CREATE INDEX IF NOT EXISTS idx_posts_embedding
        ON posts USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
      CREATE INDEX IF NOT EXISTS idx_feed_items_embedding
        ON feed_items USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
    `);
  }

  getDB() {
    return this.requireDB();
  }

  getPG() {
    return this.requirePG();
  }

  getRuntimeInfo(): PaperDbRuntimeInfo {
    if (!this.runtimeInfo) {
      throw new Error('PaperDB runtime requested before init() completed');
    }

    return { ...this.runtimeInfo };
  }

  async close() {
    const pendingInit = this.initPromise;
    if (pendingInit) {
      await pendingInit.catch(() => {});
    }

    const client = this.pg;
    this.pg = null;
    this.db = null;
    this.runtimeInfo = null;
    this.initPromise = null;
    await client?.close().catch(() => {});
  }
}

export const paperDB = new PaperDB();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void paperDB.close();
  });
}
