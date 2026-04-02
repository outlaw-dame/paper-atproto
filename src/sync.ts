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
import { atpCall, atpMutate } from './lib/atproto/client';
import { resolveEmbed, resolveFacets, extractClusterSignals } from './lib/resolver/atproto';
import { extractRecordDisplayText } from './lib/atproto/recordContent';
import { z } from 'zod';
import { embeddingPipeline } from './intelligence/embeddingPipeline';
import { recordEmbeddingVector } from './perf/embeddingTelemetry';
import { extractMediaSignalsFromJson } from './lib/media/extractMediaSignals';

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
      text: z.string().optional(),
      body: z.string().optional(),
      textContent: z.string().optional(),
      content: z.unknown().optional(),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      createdAt: z.string().optional(),
      publishedAt: z.string().optional(),
      embed: z.any().optional(),
      facets: z.any().optional(),
    }).passthrough(),
    embed: z.any().optional(),
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
      
      const postsToProcess = feed
        .map(item => FeedViewPostSchema.safeParse(item))
        .filter(result => result.success)
        .map(result => (result as any).data)
        .map((item) => ({
          ...item,
          extractedContent: extractRecordDisplayText(item.post.record),
        }))
        .filter((item) => item.extractedContent.length > 0);

      if (postsToProcess.length === 0) {
        console.log('[sync] No new posts to process.');
        return;
      }

      const textsToEmbed = postsToProcess.map(item => sanitize(item.extractedContent));
      const embeddings = await embeddingPipeline.embedBatch(textsToEmbed, { mode: 'ingest', batchSize: 12 });

      await pg.transaction(async (trx) => {
        for (let i = 0; i < postsToProcess.length; i++) {
          const { post, reply } = postsToProcess[i];
          const embedding = embeddings[i] ?? [];
          if (embedding.length > 0) recordEmbeddingVector('ingest', embedding);
          const sanitizedContent = textsToEmbed[i] ?? '';

          const facets = resolveFacets(post.record.facets);
          const previewEmbed = resolveEmbed((post as { embed?: unknown }).embed ?? post.record.embed);
          const signals = extractClusterSignals(sanitizedContent, facets, previewEmbed, []);
          const rawEmbed = post.record.embed && typeof post.record.embed === 'object'
            ? post.record.embed
            : {};
          const embedJson = JSON.stringify({
            ...rawEmbed,
            _signals: signals,
            ...(previewEmbed ? { _preview: previewEmbed } : {}),
          });
          const mediaSignals = extractMediaSignalsFromJson(embedJson);

          await trx.query(
            `INSERT INTO posts (
               id,
               uri,
               author_did,
               content,
               created_at,
               reply_to,
               reply_root,
               embedding,
               embed,
               has_images,
               has_video,
               has_link,
               image_alt_text
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET
               uri = COALESCE(posts.uri, EXCLUDED.uri),
               author_did = EXCLUDED.author_did,
               content = EXCLUDED.content,
               created_at = EXCLUDED.created_at,
               reply_to = COALESCE(EXCLUDED.reply_to, posts.reply_to),
               reply_root = COALESCE(EXCLUDED.reply_root, posts.reply_root),
               embedding = COALESCE(EXCLUDED.embedding, posts.embedding),
               embed = COALESCE(EXCLUDED.embed, posts.embed),
               has_images = EXCLUDED.has_images,
               has_video = EXCLUDED.has_video,
               has_link = EXCLUDED.has_link,
               image_alt_text = COALESCE(NULLIF(EXCLUDED.image_alt_text, ''), posts.image_alt_text)`,
            [
              post.cid,
              post.uri,
              post.author.did,
              sanitizedContent,
              post.record.createdAt || post.record.publishedAt || new Date().toISOString(),
              reply?.parent?.uri ?? null,
              reply?.root?.uri ?? null,
              embedding.length ? `[${embedding.join(',')}]` : null,
              embedJson,
              mediaSignals.hasImages ? 1 : 0,
              mediaSignals.hasVideo ? 1 : 0,
              mediaSignals.hasLink ? 1 : 0,
              mediaSignals.imageAltText || null,
            ]
          );
        }
      });

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
    const embedding = await embeddingPipeline.embed(sanitizedText, { mode: 'ingest' });
    if (embedding.length > 0) recordEmbeddingVector('ingest', embedding);

    // For user-created posts (no embed), media signals are all 0
    const mediaSignals = {
      hasImages: false,
      hasVideo: false,
      hasLink: false,
      imageAltText: null,
    };

    await pg.query(
      `INSERT INTO posts (
         id,
         uri,
         author_did,
         content,
         created_at,
         reply_to,
         reply_root,
         embedding,
         embed,
         has_images,
         has_video,
         has_link,
         image_alt_text
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        response.cid,
        response.uri,
        this.agent.session?.did ?? '',
        sanitizedText,
        new Date().toISOString(),
        null,
        null,
        embedding.length ? `[${embedding.join(',')}]` : null,
        null, // embed
        mediaSignals.hasImages ? 1 : 0,
        mediaSignals.hasVideo ? 1 : 0,
        mediaSignals.hasLink ? 1 : 0,
        mediaSignals.imageAltText,
      ]
    );

    return response;
  }
}
