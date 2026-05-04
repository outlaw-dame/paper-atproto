import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  createPaperDbClient,
  type PaperDbClient,
  type PaperDbRuntimeInfo,
} from './db/runtime';
import * as schema from './schema';

const PAPER_DB_CLOSE_TIMEOUT_MS = 5_000;

async function closeClientSafely(client: PaperDbClient | null | undefined): Promise<void> {
  if (!client) return;

  const closePromise = client.close().catch(() => {});
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    closePromise,
    new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, PAPER_DB_CLOSE_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
}

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
  private closePromise: Promise<void> | null = null;

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
    if (this.closePromise) {
      await this.closePromise;
    }

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
      ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS transcript_indexed_at TIMESTAMP WITH TIME ZONE;

      -- Transcript segments: one row per merged segment with FTS + semantic search
      CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
        start_time REAL NOT NULL,
        end_time REAL,
        text TEXT NOT NULL,
        speaker TEXT,
        embedding vector(384),
        search_vector tsvector
      );

      -- Podcast chapters: chapter markers for navigation
      CREATE TABLE IF NOT EXISTS podcast_chapters (
        id TEXT PRIMARY KEY,
        feed_item_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
        start_time REAL NOT NULL,
        end_time REAL,
        title TEXT,
        img TEXT,
        url TEXT,
        is_hidden INTEGER NOT NULL DEFAULT 0
      );

      -- Create index for full-text search (GIN)
      CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
      CREATE INDEX IF NOT EXISTS idx_feed_items_search_vector ON feed_items USING GIN(search_vector);

      -- Create indexes for hot feed/search paths and foreign-key maintenance.
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_post_id ON entities (post_id);
      CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id_pub_date ON feed_items (feed_id, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items (pub_date DESC);

      -- Transcript segment and chapter indexes
      CREATE INDEX IF NOT EXISTS idx_transcript_segments_search_vector ON transcript_segments USING GIN (search_vector);
      CREATE INDEX IF NOT EXISTS idx_transcript_segments_feed_item_id ON transcript_segments (feed_item_id);
      CREATE INDEX IF NOT EXISTS idx_podcast_chapters_feed_item_id ON podcast_chapters (feed_item_id);
    `);

      // Trigger to update search_vector on insert/update
      await client.exec(`
      CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector :=
          setweight(to_tsvector('english', coalesce(new.content, '')), 'D') ||
          setweight(to_tsvector('english', coalesce(new.image_alt_text, '')), 'B');
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
        new.search_vector :=
          setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(new.content, '')), 'D');
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_feed_items_search_vector_update ON feed_items;
      CREATE TRIGGER trg_feed_items_search_vector_update
      BEFORE INSERT OR UPDATE ON feed_items
      FOR EACH ROW EXECUTE FUNCTION feed_items_search_vector_update();

      -- Trigger for transcript_segments FTS
      CREATE OR REPLACE FUNCTION transcript_segments_search_vector_update() RETURNS trigger AS $$
      BEGIN
        new.search_vector :=
          setweight(to_tsvector('english', coalesce(new.text, '')), 'B');
        RETURN new;
      END
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_transcript_segments_search_vector_update ON transcript_segments;
      CREATE TRIGGER trg_transcript_segments_search_vector_update
      BEFORE INSERT OR UPDATE ON transcript_segments
      FOR EACH ROW EXECUTE FUNCTION transcript_segments_search_vector_update();

      -- Backfill existing rows so FTS works for data inserted before triggers.
      UPDATE posts
      SET search_vector =
        setweight(to_tsvector('english', coalesce(content, '')), 'D') ||
        setweight(to_tsvector('english', coalesce(image_alt_text, '')), 'B')
      WHERE search_vector IS NULL;

      UPDATE feed_items
      SET search_vector =
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'D')
      WHERE search_vector IS NULL;

      UPDATE transcript_segments
      SET search_vector = setweight(to_tsvector('english', coalesce(text, '')), 'B')
      WHERE search_vector IS NULL;
    `);

      this.pg = client;
      this.db = db;
      this.runtimeInfo = runtime;
    } catch (error) {
      this.pg = null;
      this.db = null;
      this.runtimeInfo = null;
      await closeClientSafely(client);
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
      CREATE INDEX IF NOT EXISTS idx_transcript_segments_embedding
        ON transcript_segments USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
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
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    this.closePromise = (async () => {
      const pendingInit = this.initPromise;
      if (pendingInit) {
        await pendingInit.catch(() => {});
      }

      const client = this.pg;
      this.pg = null;
      this.db = null;
      this.runtimeInfo = null;
      this.initPromise = null;
      await closeClientSafely(client);
    })().finally(() => {
      this.closePromise = null;
    });

    await this.closePromise;
  }
}

export const paperDB = new PaperDB();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void paperDB.close();
  });
}
