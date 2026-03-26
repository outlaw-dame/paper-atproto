import { parseFeed, generateRssFeed, generateAtomFeed, generateJsonFeed } from 'feedsmith';
import * as jsonld from 'jsonld';
import { paperDB } from './db.js';
import { hybridSearch } from './search.js';

/**
 * Feed Service for consuming and generating ATOM, RSS, JSON, RDF/XML, and JSON-LD feeds.
 * Supports news, podcasts, and video content.
 */

export class FeedService {
  /**
   * Parse JSON-LD feed data into standard feed items.
   */
  private async parseJsonLdFeed(data: any) {
    const expanded = await jsonld.expand(data);
    const items: any[] = [];

    for (const item of expanded) {
      items.push({
        id: item['@id'],
        title: item['http://schema.org/name']?.[0]?.['@value'] || 'Untitled',
        description: item['http://schema.org/description']?.[0]?.['@value'] || '',
        link: item['http://schema.org/url']?.[0]?.['@value'] || item['@id'],
        pubDate: item['http://schema.org/datePublished']?.[0]?.['@value'],
        author: item['http://schema.org/author']?.[0]?.['http://schema.org/name']?.[0]?.['@value'],
      });
    }

    return {
      title: data['http://schema.org/name'] || data.name || 'JSON-LD Feed',
      description: data['http://schema.org/description'] || data.description || '',
      type: 'jsonld',
      items,
    };
  }

  /**
   * Parse RDF/XML feed data into standard feed items.
   */
  private async parseRdfXmlFeed(xmlContent: string) {
    // Simple RDF/XML parser for RSS RDF format
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');

    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid RDF/XML document');
    }

    const items: any[] = [];
    const itemElements = doc.getElementsByTagName('item');

    for (let i = 0; i < itemElements.length; i++) {
      const el = itemElements[i];
      const getTextContent = (tag: string) => el.getElementsByTagName(tag)[0]?.textContent;

      items.push({
        id: getTextContent('link') || getTextContent('rdf:about'),
        title: getTextContent('title'),
        description: getTextContent('description'),
        content: getTextContent('content:encoded') || getTextContent('description'),
        link: getTextContent('link'),
        pubDate: getTextContent('pubDate'),
        author: getTextContent('author'),
      });
    }

    return {
      title: doc.getElementsByTagName('channel')[0]?.getElementsByTagName('title')[0]?.textContent || 'RDF Feed',
      description: doc.getElementsByTagName('channel')[0]?.getElementsByTagName('description')[0]?.textContent || '',
      type: 'rdf',
      items,
    };
  }

  /**
   * Fetch and parse an external feed (RSS, ATOM, JSON, RDF/XML, JSON-LD).
   * Uses a CORS proxy for browser compatibility.
   */
  async addFeed(url: string, category: string = 'News') {
    try {
      // Use CORS proxy for browser fetching
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const data = await response.json();
      const feedContent = data.contents;

      // Try to parse with feedsmith first (handles RSS, ATOM, JSON Feed)
      let parsed: any;
      try {
        parsed = await parseFeed(feedContent);
      } catch {
        // If feedsmith fails, try JSON-LD
        try {
          const jsonData = JSON.parse(feedContent);
          parsed = await this.parseJsonLdFeed(jsonData);
        } catch {
          // If JSON-LD fails, try RDF/XML
          parsed = await this.parseRdfXmlFeed(feedContent);
        }
      }

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
   * Generate a feed from local ATProto posts in multiple formats.
   */
  async generateLocalFeed(type: 'rss' | 'atom' | 'json' | 'jsonld' | 'rdf' = 'rss') {
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
    if (type === 'jsonld') return this.generateJsonLdFeed(feedData);
    if (type === 'rdf') return this.generateRdfXmlFeed(feedData);
    return generateRssFeed(feedData);
  }

  /**
   * Generate JSON-LD format feed.
   */
  private generateJsonLdFeed(feedData: any) {
    const jsonld = {
      '@context': 'https://schema.org/',
      '@type': 'Feed',
      name: feedData.title,
      description: feedData.description,
      url: feedData.link,
      dateModified: feedData.updated.toISOString(),
      creator: {
        '@type': 'Person',
        name: feedData.author.name,
      },
      itemListElement: feedData.items.map((item: any, idx: number) => ({
        '@type': 'ListItem',
        position: idx + 1,
        url: item.link,
        item: {
          '@type': 'Article',
          headline: item.title,
          articleBody: item.content,
          author: item.author[0]?.name,
          datePublished: item.date?.toISOString(),
        },
      })),
    };
    return JSON.stringify(jsonld, null, 2);
  }

  /**
   * Generate RDF/XML format feed (RSS RDF).
   */
  private generateRdfXmlFeed(feedData: any) {
    const items = feedData.items
      .map(
        (item: any) => `
    <item rdf:about="${this.escapeXml(item.link)}">
      <title>${this.escapeXml(item.title)}</title>
      <link>${this.escapeXml(item.link)}</link>
      <description>${this.escapeXml(item.description)}</description>
      <author>${this.escapeXml(item.author[0]?.name || '')}</author>
      <pubDate>${item.date.toUTCString()}</pubDate>
    </item>`
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns="http://purl.org/rss/1.0/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel rdf:about="${this.escapeXml(feedData.link)}">
    <title>${this.escapeXml(feedData.title)}</title>
    <link>${this.escapeXml(feedData.link)}</link>
    <description>${this.escapeXml(feedData.description)}</description>
    <language>${feedData.language}</language>
    <copyright>${this.escapeXml(feedData.copyright)}</copyright>
    <items>
      <rdf:Seq>
${feedData.items.map((item: any) => `        <rdf:li rdf:resource="${this.escapeXml(item.link)}"/>`).join('\n')}
      </rdf:Seq>
    </items>
  </channel>
${items}
</rdf:RDF>`;
  }

  /**
   * Escape XML special characters.
   */
  private escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
