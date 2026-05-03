import { parseFeed, generateRssFeed, generateAtomFeed, generateJsonFeed } from 'feedsmith';
import * as jsonld from 'jsonld';
import { paperDB } from './db';
import { embeddingPipeline } from './intelligence/embeddingPipeline';
import { recordEmbeddingVector } from './perf/embeddingTelemetry';
import { BackoffTimer, type BackoffConfig } from './lib/backoffStrategy';
import { detectTranscriptFormat, parseTranscript } from './lib/transcriptParser';
import { parsePodcastChapters } from './lib/chaptersParser';
import { sanitizeUrlForProcessing } from './lib/safety/externalUrl';

/**
 * Feed Service for consuming and generating ATOM, RSS, JSON, RDF/XML, and JSON-LD feeds.
 * Supports news, podcasts, and video content.
 */

const TRANSCRIPT_FETCH_TIMEOUT_MS = 15_000;
const CHAPTERS_FETCH_TIMEOUT_MS = 8_000;
const MAX_TRANSCRIPT_BYTES = 2_097_152; // 2 MB
const MAX_CHAPTERS_BYTES = 524_288;    // 512 KB

const TRANSCRIPT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 200,
  maxDelayMs: 5_000,
  multiplier: 2.0,
  useJitter: true,
  maxRetries: 2,
};

const CHAPTERS_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 200,
  maxDelayMs: 3_000,
  multiplier: 2.0,
  useJitter: true,
  maxRetries: 2,
};

export class FeedService {
  private readonly transcriptBackoff = new BackoffTimer(TRANSCRIPT_BACKOFF_CONFIG);
  private readonly chaptersBackoff = new BackoffTimer(CHAPTERS_BACKOFF_CONFIG);

  private getFirstChildByLocalName(parent: Element, localName: string): Element | null {
    const all = parent.getElementsByTagName('*');
    for (let i = 0; i < all.length; i += 1) {
      const node = all.item(i);
      if (!node) continue;
      if (node.localName?.toLowerCase() === localName.toLowerCase()) {
        return node;
      }
    }
    return null;
  }

  private parsePodcast20Metadata(xmlContent: string): Map<string, { transcriptUrl?: string; chaptersUrl?: string; valueConfig?: unknown }> {
    const metadataByKey = new Map<string, { transcriptUrl?: string; chaptersUrl?: string; valueConfig?: unknown }>();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlContent, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length > 0) {
        return metadataByKey;
      }

      const items = doc.getElementsByTagName('item');
      for (let i = 0; i < items.length; i += 1) {
        const item = items.item(i);
        if (!item) continue;
        const guid = item.getElementsByTagName('guid')[0]?.textContent?.trim();
        const link = item.getElementsByTagName('link')[0]?.textContent?.trim();
        const enclosureUrl = item.getElementsByTagName('enclosure')[0]?.getAttribute('url')?.trim();

        const transcriptEl = this.getFirstChildByLocalName(item, 'transcript');
        const chaptersEl = this.getFirstChildByLocalName(item, 'chapters');
        const valueEl = this.getFirstChildByLocalName(item, 'value');

        const transcriptUrl = transcriptEl?.getAttribute('url')?.trim() || undefined;
        const chaptersUrl = chaptersEl?.getAttribute('url')?.trim() || undefined;

        let valueConfig: unknown;
        if (valueEl) {
          const recipients = valueEl.getElementsByTagName('*');
          const valueRecipients: Array<Record<string, string>> = [];
          for (let r = 0; r < recipients.length; r += 1) {
            const recipientNode = recipients.item(r);
            if (!recipientNode) continue;
            if (recipientNode.localName?.toLowerCase() !== 'valuerecipient') continue;
            const record: Record<string, string> = {};
            for (let a = 0; a < recipientNode.attributes.length; a += 1) {
              const attr = recipientNode.attributes.item(a);
              if (!attr) continue;
              record[attr.name] = attr.value;
            }
            valueRecipients.push(record);
          }

          valueConfig = {
            method: valueEl.getAttribute('method') || undefined,
            type: valueEl.getAttribute('type') || undefined,
            suggested: valueEl.getAttribute('suggested') || undefined,
            recipients: valueRecipients,
          };
        }

        const meta: { transcriptUrl?: string; chaptersUrl?: string; valueConfig?: unknown } = {
          ...(transcriptUrl ? { transcriptUrl } : {}),
          ...(chaptersUrl ? { chaptersUrl } : {}),
          ...(valueConfig !== undefined ? { valueConfig } : {}),
        };
        const keys = [guid, link, enclosureUrl].filter((key): key is string => Boolean(key));
        keys.forEach((key) => metadataByKey.set(key, meta));
      }
    } catch {
      return metadataByKey;
    }

    return metadataByKey;
  }

  private getPodcast20ForItem(
    item: any,
    metadataByKey: Map<string, { transcriptUrl?: string; chaptersUrl?: string; valueConfig?: unknown }>,
  ) {
    const keyCandidates = [
      item?.enclosure?.url,
      item?.id,
      item?.guid,
      item?.link,
    ].filter((key): key is string => Boolean(key));

    for (const key of keyCandidates) {
      const hit = metadataByKey.get(key);
      if (hit) return hit;
    }
    return {};
  }

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
      const el = itemElements.item(i);
      if (!el) continue;
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
   * Fetch a URL via the CORS proxy and return its content and detected content-type.
   * Enforces a size cap and abort timeout. Returns null on any failure.
   */
  private async fetchViaProxy(
    url: string,
    timeoutMs: number,
    maxBytes: number,
  ): Promise<{ content: string; contentType: string } | null> {
    const safeUrl = sanitizeUrlForProcessing(url);
    if (!safeUrl) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(safeUrl)}`;
      const response = await fetch(proxyUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Proxy returned HTTP ${response.status}`);

      const data = await response.json();
      const content = String(data?.contents ?? '');
      if (content.length > maxBytes) {
        throw new Error(`Response too large: ${content.length} bytes (max ${maxBytes})`);
      }

      const contentType = String(data?.status?.content_type ?? '');
      return { content, contentType };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch, parse, and store transcript segments for a feed item.
   * Best-effort: errors are logged and never propagated.
   */
  private async indexTranscript(pg: any, feedItemId: string, transcriptUrl: string): Promise<void> {
    const fetched = await this.transcriptBackoff.execute(
      () => this.fetchViaProxy(transcriptUrl, TRANSCRIPT_FETCH_TIMEOUT_MS, MAX_TRANSCRIPT_BYTES),
      'fetchTranscript',
    );
    if (!fetched || !fetched.content.trim()) return;

    const format = detectTranscriptFormat(fetched.contentType, transcriptUrl, fetched.content);
    const segments = parseTranscript(fetched.content, format);
    if (segments.length === 0) return;

    for (const seg of segments) {
      const segId = `${feedItemId}:seg:${seg.startTime.toFixed(3)}`;
      const embeddingArr = await embeddingPipeline.embed(seg.text, { mode: 'ingest' });
      if (embeddingArr.length > 0) recordEmbeddingVector('ingest', embeddingArr);
      const embedding = embeddingArr.length > 0 ? `[${embeddingArr.join(',')}]` : null;

      await pg.query(
        `INSERT INTO transcript_segments (id, feed_item_id, start_time, end_time, text, speaker, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           text = EXCLUDED.text,
           speaker = EXCLUDED.speaker,
           embedding = EXCLUDED.embedding`,
        [
          segId,
          feedItemId,
          seg.startTime,
          seg.endTime ?? null,
          seg.text,
          seg.speaker ?? null,
          embedding,
        ],
      );
    }
  }

  /**
   * Fetch, parse, and store chapter markers for a feed item.
   * Best-effort: errors are logged and never propagated.
   */
  private async indexChapters(pg: any, feedItemId: string, chaptersUrl: string): Promise<void> {
    const fetched = await this.chaptersBackoff.execute(
      () => this.fetchViaProxy(chaptersUrl, CHAPTERS_FETCH_TIMEOUT_MS, MAX_CHAPTERS_BYTES),
      'fetchChapters',
    );
    if (!fetched || !fetched.content.trim()) return;

    const chapters = parsePodcastChapters(fetched.content);
    if (chapters.length === 0) return;

    for (const ch of chapters) {
      const chId = `${feedItemId}:ch:${ch.startTime.toFixed(3)}`;
      await pg.query(
        `INSERT INTO podcast_chapters (id, feed_item_id, start_time, end_time, title, img, url, is_hidden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           end_time = EXCLUDED.end_time,
           img = EXCLUDED.img,
           url = EXCLUDED.url,
           is_hidden = EXCLUDED.is_hidden`,
        [
          chId,
          feedItemId,
          ch.startTime,
          ch.endTime ?? null,
          ch.title ?? null,
          ch.img ?? null,
          ch.url ?? null,
          ch.isHidden ? 1 : 0,
        ],
      );
    }
  }

  /**
   * Fetch and index transcript segments + chapter markers for a batch of items.
   * Skips items already indexed (transcript_indexed_at IS NOT NULL).
   * Runs sequentially to limit network concurrency and avoid browser throttling.
   * Best-effort: individual failures are logged and never propagate.
   */
  private async indexTranscriptBatch(
    pg: any,
    items: Array<{ itemId: string; transcriptUrl?: string; chaptersUrl?: string }>,
  ): Promise<void> {
    for (const item of items) {
      try {
        // Idempotency check: skip if already successfully indexed
        const check = await pg.query(
          'SELECT transcript_indexed_at FROM feed_items WHERE id = $1',
          [item.itemId],
        );
        const row = check.rows[0] as { transcript_indexed_at: string | null } | undefined;
        if (!row || row.transcript_indexed_at) continue;

        await Promise.all([
          item.transcriptUrl
            ? this.indexTranscript(pg, item.itemId, item.transcriptUrl)
            : Promise.resolve(),
          item.chaptersUrl
            ? this.indexChapters(pg, item.itemId, item.chaptersUrl)
            : Promise.resolve(),
        ]);

        // Mark indexed so subsequent re-syncs skip this item
        await pg.query(
          'UPDATE feed_items SET transcript_indexed_at = NOW() WHERE id = $1',
          [item.itemId],
        );
      } catch (err) {
        console.warn(
          `[FeedService] Transcript/chapter indexing failed for item ${item.itemId}:`,
          err instanceof Error ? err.message : 'unknown error',
        );
      }
    }
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
      let podcast20ByKey = new Map<string, { transcriptUrl?: string; chaptersUrl?: string; valueConfig?: unknown }>();
      try {
        parsed = await parseFeed(feedContent);
        // Podcast namespace extensions are XML-specific, parse raw XML to enrich items.
        podcast20ByKey = this.parsePodcast20Metadata(feedContent);
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

      const feedId = (feedResult.rows[0] as { id: string } | undefined)?.id;
      if (!feedId) {
        throw new Error('Feed insert did not return an id');
      }

      // 2. Save feed items
      for (const item of parsed.items) {
        const itemId = item.id || item.link;
        const content = item.content || item.description || '';
        const podcast20 = this.getPodcast20ForItem(item, podcast20ByKey);

        // Generate embedding for hybrid search — format as pgvector string [x,y,...]
        const embeddingArr = await embeddingPipeline.embed(item.title + ' ' + content, { mode: 'ingest' });
        if (embeddingArr.length > 0) recordEmbeddingVector('ingest', embeddingArr);
        const embedding = embeddingArr.length ? `[${embeddingArr.join(',')}]` : null;

        await pg.query(
          `INSERT INTO feed_items (
             id, feed_id, title, content, link, pub_date, author, enclosure_url, enclosure_type,
             transcript_url, chapters_url, value_config, embedding
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             content = EXCLUDED.content,
             link = EXCLUDED.link,
             pub_date = EXCLUDED.pub_date,
             author = EXCLUDED.author,
             enclosure_url = EXCLUDED.enclosure_url,
             enclosure_type = EXCLUDED.enclosure_type,
             transcript_url = COALESCE(EXCLUDED.transcript_url, feed_items.transcript_url),
             chapters_url = COALESCE(EXCLUDED.chapters_url, feed_items.chapters_url),
             value_config = COALESCE(EXCLUDED.value_config, feed_items.value_config),
             embedding = EXCLUDED.embedding`,
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
            podcast20.transcriptUrl,
            podcast20.chaptersUrl,
            podcast20.valueConfig ? JSON.stringify(podcast20.valueConfig) : null,
            embedding,
          ]
        );
      }

      // Collect podcast items with transcript/chapter URLs for async enrichment
      const podcastItemsToIndex: Array<{ itemId: string; transcriptUrl?: string; chaptersUrl?: string }> = [];
      for (const item of parsed.items) {
        const itemId = item.id || item.link;
        const podcast20 = this.getPodcast20ForItem(item, podcast20ByKey);
        if (podcast20.transcriptUrl || podcast20.chaptersUrl) {
          podcastItemsToIndex.push({
            itemId,
            ...(podcast20.transcriptUrl ? { transcriptUrl: podcast20.transcriptUrl } : {}),
            ...(podcast20.chaptersUrl ? { chaptersUrl: podcast20.chaptersUrl } : {}),
          });
        }
      }

      // Fire-and-forget: transcript/chapter indexing enriches search in the background
      // and never blocks or fails addFeed
      if (podcastItemsToIndex.length > 0) {
        void this.indexTranscriptBatch(pg, podcastItemsToIndex);
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

    if (type === 'atom') return generateAtomFeed(feedData as any);
    if (type === 'json') return generateJsonFeed(feedData as any);
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

  /**
   * Get recent feed items across all subscribed feeds.
   */
  async getRecentFeedItems(limit = 20) {
    const pg = paperDB.getPG();
    const result = await pg.query(
      `SELECT fi.*, f.title AS feed_title, f.category AS feed_category, f.type AS feed_type
       FROM feed_items fi
       LEFT JOIN feeds f ON fi.feed_id = f.id
       ORDER BY fi.pub_date DESC NULLS LAST
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return result.rows;
  }
}

export const feedService = new FeedService();
