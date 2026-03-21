import { pgTable, text, timestamp, uuid, vector, customType } from 'drizzle-orm/pg-core';

// Custom type for tsvector (Full-Text Search)
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorDid: text('author_did').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  embedding: vector('embedding', { dimensions: 384 }), // For semantic search
  searchVector: tsvector('search_vector'), // For full-text search
  embed: text('embed'), // JSON string of ATProto embed
});

export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  type: text('type').notNull(), // PERSON, ORG, LOC, etc.
  wikidataId: text('wikidata_id'), // Linked entity ID
  score: text('score'), // Confidence score
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
