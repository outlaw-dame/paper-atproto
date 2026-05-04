import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paperDB } from '../db';
import { migrateLocalDatabase } from './migrations';

describe('migrateLocalDatabase', () => {
  beforeAll(async () => {
    await paperDB.init();
    await migrateLocalDatabase();
  });

  afterAll(async () => {
    await paperDB.close();
  });

  it('ensures thread context columns exist on posts', async () => {
    const result = await paperDB.getPG().query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'posts'
        AND column_name IN ('uri', 'reply_to', 'reply_root')
    `);

    const rows = (result.rows ?? []) as Array<{ column_name?: string }>;
    const columnNames = new Set(rows.map((row) => row.column_name));

    expect(columnNames).toEqual(new Set(['uri', 'reply_to', 'reply_root']));
  });

  it('creates indexes for hot local access paths', async () => {
    const result = await paperDB.getPG().query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
    `);

    const rows = (result.rows ?? []) as Array<{ indexname?: string }>;
    const indexNames = new Set(rows.map((row) => row.indexname));

    const requiredIndexes = [
      'idx_posts_uri',
      'idx_posts_created_at',
      'idx_entities_post_id',
      'idx_feed_items_feed_id_pub_date',
      'idx_feed_items_pub_date',
    ];

    for (const indexName of requiredIndexes) {
      expect(indexNames.has(indexName)).toBe(true);
    }
  });
});
