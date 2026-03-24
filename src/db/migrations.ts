import { paperDB } from '../db.js';

/**
 * Runs SQL migrations to ensure the PGlite schema supports
 * context-aware posts (replies and threads).
 */
export async function migratePostsTable() {
  const pg = paperDB.getPG();
  console.log('[Migration] Checking posts table schema...');

  try {
    // Add columns for context if they don't exist
    await pg.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS uri TEXT;`);
    await pg.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_to TEXT;`);
    await pg.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_root TEXT;`);

    // Add an index on URI since we might lookup posts by their AT URI (for thread resolution)
    await pg.query(`CREATE INDEX IF NOT EXISTS idx_posts_uri ON posts (uri);`);

    console.log('[Migration] Posts table schema updated successfully.');
  } catch (err) {
    console.error('[Migration] Failed to update posts table schema:', err);
  }
}