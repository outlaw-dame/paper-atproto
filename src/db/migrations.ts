import { paperDB } from '../db';

/**
 * Runs idempotent local database migrations for schema backfills and
 * performance-critical indexes.
 */
export async function migrateLocalDatabase() {
  const pg = paperDB.getPG();
  console.log('[Migration] Checking local database schema and indexes...');

  try {
    await pg.exec(`
      -- Backfill context columns used for thread resolution.
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS uri TEXT;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_to TEXT;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_root TEXT;

      -- Thread lookup path.
      CREATE INDEX IF NOT EXISTS idx_posts_uri ON posts (uri);

      -- Hot sort/filter paths and referencing-column indexes that PostgreSQL
      -- intentionally does not create automatically for foreign keys.
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_post_id ON entities (post_id);
      CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id_pub_date ON feed_items (feed_id, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_items_pub_date ON feed_items (pub_date DESC);

      -- Keep materialized tsvectors weighted and consistent across updates.
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

      -- Backfill existing rows that were created before trigger setup.
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
    `);

    console.log('[Migration] Local database schema updated successfully.');
  } catch (err) {
    console.error('[Migration] Failed to update local database schema:', err);
  }
}

// Backwards-compatible export for older call sites/tests.
export const migratePostsTable = migrateLocalDatabase;
