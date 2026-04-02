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
    `);

    console.log('[Migration] Local database schema updated successfully.');
  } catch (err) {
    console.error('[Migration] Failed to update local database schema:', err);
  }
}

// Backwards-compatible export for older call sites/tests.
export const migratePostsTable = migrateLocalDatabase;
