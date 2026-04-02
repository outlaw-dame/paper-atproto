import { pgTable, text, timestamp, uuid, vector, customType, jsonb, integer } from 'drizzle-orm/pg-core';

// Custom type for tsvector (Full-Text Search)
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  uri: text('uri'),
  authorDid: text('author_did').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  replyTo: text('reply_to'),
  replyRoot: text('reply_root'),
  embedding: vector('embedding', { dimensions: 384 }), // For semantic search
  searchVector: tsvector('search_vector'), // For full-text search
  embed: text('embed'), // JSON string of ATProto embed
  // Media signals for ranking boost
  hasImages: integer('has_images').default(0).notNull(), // 0|1 for quick filtering
  hasVideo: integer('has_video').default(0).notNull(),
  hasLink: integer('has_link').default(0).notNull(),
  imageAltText: text('image_alt_text'), // Concatenated ALT texts for media-aware ranking
});

export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  postId: text('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  type: text('type').notNull(), // PERSON, ORG, LOC, etc.
  wikidataId: text('wikidata_id'), // Linked entity ID
  score: text('score'), // Confidence score
});

export const feeds = pgTable('feeds', {
  id: uuid('id').defaultRandom().primaryKey(),
  url: text('url').unique().notNull(),
  title: text('title'),
  description: text('description'),
  type: text('type').notNull(), // RSS, ATOM, JSON, JSON-LD, RDF
  lastSyncedAt: timestamp('last_synced_at'),
  category: text('category'), // News, Podcast, Video, etc.
});

export const feedItems = pgTable('feed_items', {
  id: text('id').primaryKey(), // Usually the link or a hash
  feedId: uuid('feed_id').references(() => feeds.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content'),
  link: text('link').notNull(),
  pubDate: timestamp('pub_date'),
  author: text('author'),
  enclosureUrl: text('enclosure_url'), // For podcasts/videos
  enclosureType: text('enclosure_type'),
  transcriptUrl: text('transcript_url'),
  chaptersUrl: text('chapters_url'),
  valueConfig: jsonb('value_config'),
  embedding: vector('embedding', { dimensions: 384 }), // For semantic search
  searchVector: tsvector('search_vector'), // For full-text search
});

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type Feed = typeof feeds.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type FeedItem = typeof feedItems.$inferSelect;
export type NewFeedItem = typeof feedItems.$inferInsert;
