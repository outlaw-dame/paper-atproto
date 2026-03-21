import { parseFeed, generateRssFeed, generateAtomFeed, generateJsonFeed } from 'feedsmith';
import { paperDB } from './db';
import { hybridSearch } from './search';

/**
 * Feed Service for consuming and generating ATOM, RSS, and JSON feeds.
 * Supports news, podcasts, and video content.
 */

export class FeedService {
  /**
   * Fetch and parse an external feed.
   * Uses a CORS proxy for browser compatibility.
   */
  async addFeed(url: string, category: string = 'News') {
    try {
      // Use CORS proxy for browser fetching
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const data = await response.json();
      const feedContent = data.contents;

      // Parse feed using feedsmith
      const parsed = await parseFeed(feedContent);
      const pg = paperDB.getPG();

      // 1. Save feed metadata
      const feedResult = await pg.query(
        `INSERT INTO feeds (url, title, description, type, category, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (url) DO UPDATE SET 
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           last_synced_at = NOW()
         RETURNING id`,
        [url, parsed.title, parsed.description, parsed.type, category]
      );

      const feedId = feedResult.rows[0].id;

      // 2. Save feed items
      for (const item of parsed.items) {
        const itemId = item.id || item.link;
        const content = item.content || item.description || '';
        
        // Generate embedding for hybrid search
        const embedding = await hybridSearch.generateEmbedding(item.title + ' ' + content);

        await pg.query(
          `INSERT INTO feed_items (id, feed_id, title, content, link, pub_date, author, enclosure_url, enclosure_type, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            itemId,
            feedId,
            item.title,
            content,
            item.link,
            item.pubDate,
            item.author,
            item.enclosure?.url,
            item.enclosure?.type,
            embedding,
          ]
        );
      }

      return { feedId, title: parsed.title, itemCount: parsed.items.length };
    } catch (error) {
      console.error('Failed to add feed:', error);
      throw error;
    }
  }

  /**
   * Generate a feed from local ATProto posts.
   */
  async generateLocalFeed(type: 'rss' | 'atom' | 'json' = 'rss') {
    const pg = paperDB.getPG();
    const postsResult = await pg.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50');
    
    const feedData = {
      title: 'Paper ATProto Local Feed',
      description: 'Latest posts from my local ATProto repository',
      id: 'https://paper-atproto.local',
      link: 'https://paper-atproto.local',
      language: 'en',
      copyright: 'All rights reserved',
      updated: new Date(),
      generator: 'Paper ATProto FeedService',
      author: {
        name: 'Paper User',
      },
      items: postsResult.rows.map((post: any) => ({
        title: post.content.substring(0, 50) + '...',
        id: post.id,
        link: `at://${post.author_did}/app.bsky.feed.post/${post.id}`,
        description: post.content,
        content: post.content,
        author: [{ name: post.author_did }],
        date: new Date(post.created_at),
      })),
    };

    if (type === 'atom') return generateAtomFeed(feedData);
    if (type === 'json') return generateJsonFeed(feedData);
    return generateRssFeed(feedData);
  }

  /**
   * Get all subscribed feeds.
   */
  async getFeeds() {
    const pg = paperDB.getPG();
    const result = await pg.query('SELECT * FROM feeds ORDER BY title ASC');
    return result.rows;
  }

  /**
   * Get items for a specific feed.
   */
  async getFeedItems(feedId: string) {
    const pg = paperDB.getPG();
    const result = await pg.query(
      'SELECT * FROM feed_items WHERE feed_id = $1 ORDER BY pub_date DESC LIMIT 50',
      [feedId]
    );
    return result.rows;
  }
}

export const feedService = new FeedService();
