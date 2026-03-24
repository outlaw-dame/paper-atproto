// ─── ATProto Sync Layer ────────────────────────────────────────────────────
// Syncs timeline posts into the local PGlite database.
//
// Key architectural changes from the original:
//   1. Embeddings are generated via the inference worker (off main thread)
//   2. NER + Wikidata entity linking is REMOVED from the sync hot path
//      per the architecture review — deterministic ATProto object resolution
//      (facets, DIDs, AT URIs) replaces it as the default entity layer
//   3. Cluster signals (hashtags, domains, mentions, quoted URIs) are stored
//      as structured JSON for Pipeline A grouping, not as Wikidata entities
//   4. The entities table is preserved for optional background enrichment only

import { BskyAgent } from '@atproto/api';
import { paperDB } from './db';
import { inferenceClient } from './workers/InferenceClient';
import { atpCall, atpMutate } from './lib/atproto/client';
import { resolveEmbed, resolveFacets, extractClusterSignals } from './lib/resolver/atproto';
import { z } from 'zod';
import { AppBskyFeedDefs } from '@atproto/api';

// ─── Zod schema for ATProto post validation ────────────────────────────────
const FeedViewPostSchema = z.object({
  post: z.object({
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
      facets: z.any().optional(),
    }),
  }),
  reply: z.object({
    root: z.object({ uri: z.string() }).passthrough().optional(),
    parent: z.object({ uri: z.string() }).passthrough().optional(),
  }).optional(),
});

function sanitize(content: string): string {
  return content.replace(/<[^>]*>?/gm, '').trim();
}

export class PaperSync {
  private agent: BskyAgent;

  constructor(agent: BskyAgent) {
    this.agent = agent;
  }

  /**
   * Sync the latest posts from the user's timeline into local PGlite.
   * Embeddings are generated off-thread via the inference worker.
   * NER and Wikidata linking are NOT called here — see Pipeline A for
   * on-demand enrichment when a Story card is opened.
   */
  async syncTimeline() {
    try {
      // Wrapped in atpCall for retries, timeouts, and error normalization
      const response = await atpCall(() => this.agent.getTimeline({ limit: 20 }));
      
      const feed = response.data.feed;
      const pg = paperDB.getPG();

      for (const item of feed as AppBskyFeedDefs.FeedViewPost[]) {
        const validated = FeedViewPostSchema.safeParse(item);
        if (!validated.success) {
          console.warn('Skipping invalid post from feed:', validated.error);
          continue;
        }

        const { post, reply } = validated.data;
        const postId = post.cid;
        const sanitizedContent = sanitize(post.record.text);
        if (!sanitizedContent) continue;

        // Generate embedding via worker (non-blocking relative to UI)
        const embedding = await inferenceClient.embed(sanitizedContent);

        // Resolve deterministic ATProto signals
        const facets = resolveFacets(post.record.facets);
        const embed = resolveEmbed(post.record.embed);
        const signals = extractClusterSignals(sanitizedContent, facets, embed, []);

        await pg.query(
          // NOTE: This assumes the 'posts' table has been migrated to include 'uri', 'reply_to', and 'reply_root' columns.
          `INSERT INTO posts (id, uri, author_did, content, created_at, embedding, embed, reply_to, reply_root)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            postId,
            post.uri,
            post.author.did,
            sanitizedContent,
            post.record.createdAt,
            embedding.length ? `[${embedding.join(',')}]` : null,
            JSON.stringify({
              ...post.record.embed,
              _signals: signals,   // store cluster signals alongside embed
            }),
            reply?.parent?.uri ?? null,
            reply?.root?.uri ?? null,
          ]
        );
      }

      console.log(`[sync] Synced ${feed.length} posts (embeddings via worker, deterministic signals only)`);
    } catch (error) {
      console.error('[sync] Timeline sync failed:', error);
    }
  }

  /**
   * Create a new post on the PDS and index it locally.
   */
  async createPost(text: string) {
    const sanitizedText = sanitize(text);
    if (!sanitizedText) throw new Error('Post content cannot be empty');

    // Wrapped in atpMutate (no retry on failure, returns null on error)
    const response = await atpMutate(() => this.agent.post({
      text: sanitizedText,
      createdAt: new Date().toISOString(),
    })) ?? (() => { throw new Error('Failed to post'); })();

    const pg = paperDB.getPG();
    const embedding = await inferenceClient.embed(sanitizedText);

    await pg.query(
      // NOTE: This assumes the 'posts' table has been migrated to include 'uri', 'reply_to', and 'reply_root' columns.
      `INSERT INTO posts (id, uri, author_did, content, created_at, embedding, embed, reply_to, reply_root)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        response.cid,
        response.uri,
        this.agent.session?.did ?? '',
        sanitizedText,
        new Date().toISOString(),
        embedding.length ? `[${embedding.join(',')}]` : null,
        null, // embed
        null, // reply_to
        null, // reply_root
      ]
    );

    return response;
  }
}
