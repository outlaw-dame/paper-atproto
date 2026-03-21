import { BskyAgent } from '@atproto/api';
import { paperDB } from './db';
import { hybridSearch } from './search';

/**
 * Utility for sanitizing content to prevent XSS and other injection attacks.
 */
function sanitizeContent(content: string): string {
  // Basic sanitization: remove HTML tags and trim whitespace
  // In a real app, use a more robust library like DOMPurify
  return content.replace(/<[^>]*>?/gm, '').trim();
}

/**
 * Synchronization service for ATProto records.
 */
export class PaperSync {
  private agent: BskyAgent;

  constructor(agent: BskyAgent) {
    this.agent = agent;
  }

  /**
   * Performs a full synchronization of the user's posts from their PDS.
   */
  async syncPosts(did: string) {
    console.log(`Starting sync for user: ${did}`);
    let cursor: string | undefined;
    const db = paperDB.getDB();

    try {
      while (true) {
        const response = await this.agent.api.app.bsky.feed.getAuthorFeed({
          actor: did,
          cursor,
          limit: 50,
        });

        const { feed, cursor: nextCursor } = response.data;

        for (const item of feed) {
          const post = item.post;
          const record = post.record as any;

          // Sanitize and validate the record content
          const sanitizedContent = sanitizeContent(record.text || '');

          // Index the post for hybrid search and store in local DB
          await hybridSearch.indexPost({
            id: post.uri.split('/').pop() || '',
            uri: post.uri,
            cid: post.cid,
            author_did: post.author.did,
            content: sanitizedContent,
          });
        }

        if (!nextCursor || feed.length === 0) break;
        cursor = nextCursor;
      }
      console.log('Sync completed successfully');
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
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
      await hybridSearch.indexPost({
        id: response.uri.split('/').pop() || '',
        uri: response.uri,
        cid: response.cid,
        author_did: this.agent.session?.did || '',
        content: sanitizedText,
      });

      return response;
    } catch (error) {
      console.error('Failed to create post:', error);
      throw error;
    }
  }

  /**
   * Resolves conflicts between local and remote data.
   * Currently implements a simple "last-write-wins" strategy.
   */
  async resolveConflict(localData: any, remoteData: any) {
    // In a more advanced implementation, this would compare timestamps or use CRDTs
    console.log('Resolving conflict using last-write-wins strategy');
    return remoteData;
  }
}
