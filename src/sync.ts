import { BskyAgent } from '@atproto/api';
import { paperDB } from './db';
import { hybridSearch } from './search';
import { processTextEntities } from './linking';
import { z } from 'zod';

/**
 * Robust Data Synchronization Layer for ATProto.
 * Includes entity mapping (Zod) and entity linking (Transformers.js).
 */

// Zod schema for ATProto post validation
const PostSchema = z.object({
  uri: z.string(),
  cid: z.string(),
  author: z.object({
    did: z.string(),
    handle: z.string(),
  }),
  record: z.object({
    text: z.string(),
    createdAt: z.string(),
    embed: z.any().optional(),
  }),
});

/**
 * Utility for sanitizing content to prevent XSS and other injection attacks.
 */
function sanitizeContent(content: string): string {
  // Basic sanitization: remove HTML tags and trim whitespace
  return content.replace(/<[^>]*>?/gm, '').trim();
}

export class PaperSync {
  private agent: BskyAgent;

  constructor(agent: BskyAgent) {
    this.agent = agent;
  }

  /**
   * Sync the latest posts from the user's timeline.
   */
  async syncTimeline() {
    try {
      const response = await this.agent.getTimeline({ limit: 20 });
      const feed = response.data.feed;
      const pg = paperDB.getPG();

      for (const item of feed) {
        // 1. Validate and Map Entity (Zod)
        const validated = PostSchema.safeParse(item.post);
        if (!validated.success) continue;

        const post = validated.data;
        const postId = post.cid;
        const sanitizedContent = sanitizeContent(post.record.text);

        // 2. Generate Semantic Embedding
        const embedding = await hybridSearch.generateEmbedding(sanitizedContent);

        // 3. Save to Local PGlite (Entity Mapping)
        await pg.query(
          `INSERT INTO posts (id, author_did, content, created_at, embedding, embed)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [
            postId,
            post.author.did,
            sanitizedContent,
            post.record.createdAt,
            embedding,
            JSON.stringify(post.record.embed || {}),
          ]
        );

        // 4. Entity Linking (Transformers.js + Wikidata)
        const linkedEntities = await processTextEntities(sanitizedContent);
        for (const entity of linkedEntities) {
          await pg.query(
            `INSERT INTO entities (post_id, text, type, wikidata_id, score)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              postId,
              entity.text,
              entity.type,
              entity.wikidataId || null,
              entity.score.toString(),
            ]
          );
        }
      }

      console.log(`Synced ${feed.length} posts with entity linking.`);
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }

  /**
   * Pushes a new post to the PDS and updates the local database.
   */
  async createPost(text: string) {
    const sanitizedText = sanitizeContent(text);
    if (!sanitizedText) throw new Error('Post content cannot be empty');

    try {
      // 1. Push to PDS
      const response = await this.agent.post({
        text: sanitizedText,
        createdAt: new Date().toISOString(),
      });

      // 2. Update local database and search index
      const pg = paperDB.getPG();
      const embedding = await hybridSearch.generateEmbedding(sanitizedText);
      
      await pg.query(
        `INSERT INTO posts (id, author_did, content, created_at, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          response.cid,
          this.agent.session?.did || '',
          sanitizedText,
          new Date().toISOString(),
          embedding,
        ]
      );

      return response;
    } catch (error) {
      console.error('Failed to create post:', error);
      throw error;
    }
  }
}
