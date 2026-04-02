// ─── Hybrid Search ────────────────────────────────────────────────────────
// Combines Full-Text Search (FTS) and Semantic Search using Reciprocal Rank
// Fusion (RRF). Runs entirely in the browser using PGlite + pgvector.
//
// Embeddings are generated via the inference worker (off main thread).
// This module no longer imports from @xenova/transformers directly.

import { paperDB } from './db';
import { embeddingPipeline, sanitizeForEmbedding } from './intelligence/embeddingPipeline';
import { recordEmbeddingVector } from './perf/embeddingTelemetry';
import {
  extractMediaSignalsFromJson,
  getMediaBoostFactor,
  type MediaSignals,
} from './lib/media/extractMediaSignals';

interface SearchOptions {
  policyVersion?: string;
  moderationProfileHash?: string;
  disableCache?: boolean;
  queryHasVisualIntent?: boolean; // NEW: for media-aware ranking
}

interface CachedVector {
  value: number[];
  expiresAt: number;
}

const QUERY_EMBED_CACHE_TTL_MS = 60_000;
const QUERY_EMBED_CACHE_MAX = 128;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

function normalizeSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_SEARCH_LIMIT));
}

function clampHnswEfSearch(candidateCount: number): number {
  if (!Number.isFinite(candidateCount)) return 40;
  return Math.max(40, Math.min(Math.trunc(candidateCount), 128));
}

function isEfSearchSettingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('hnsw.ef_search')
    || message.includes('unrecognized configuration parameter');
}

function normalizePolicyVersion(raw: string | undefined): string {
  if (!raw) return 'policy-v1';
  return raw.trim().slice(0, 64) || 'policy-v1';
}

function normalizeModerationHash(raw: string | undefined): string {
  if (!raw) return 'default';
  return raw.trim().slice(0, 128) || 'default';
}

function normalizeQueryForCache(raw: string): string {
  return sanitizeForEmbedding(raw).slice(0, 256);
}

/**
 * Detect if a query suggests visual/media search intent.
 * Examples: "meme", "screenshot", "video", "illustration", "chart", etc.
 */
function queryHasVisualIntent(query: string): boolean {
  const visualKeywords = [
    'meme', 'screenshot', 'video', 'image', 'photo', 'picture',
    'illustration', 'chart', 'graph', 'diagram', 'visual', 'design', 'art',
    'artwork', 'drawing', 'sketch', 'appearance', 'looks', 'see', 'watch',
  ];
  const normalizedQuery = query.toLowerCase();
  return visualKeywords.some(keyword => normalizedQuery.includes(keyword));
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isImageLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isVideoLikeMime(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

function isImageLikeUrl(url: string): boolean {
  return /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(url);
}

function isVideoLikeUrl(url: string): boolean {
  return /\.(m3u8|mov|mp4|m4v|webm)(\?.*)?$/i.test(url);
}

function deriveRowMediaSignals(row: any): MediaSignals {
  const embeddedSignals = extractMediaSignalsFromJson(
    typeof row?.embed === 'string' ? row.embed : null,
  );
  const explicitHasImages = Number(row?.has_images ?? 0) === 1;
  const explicitHasVideo = Number(row?.has_video ?? 0) === 1;
  const explicitHasLink = Number(row?.has_link ?? 0) === 1;
  const imageAltText = normalizeOptionalString(row?.image_alt_text) || embeddedSignals.imageAltText;
  const enclosureType = normalizeOptionalString(row?.enclosure_type).toLowerCase();
  const enclosureUrl = normalizeOptionalString(row?.enclosure_url);
  const link = normalizeOptionalString(row?.link);
  const transcriptUrl = normalizeOptionalString(row?.transcript_url);
  const chaptersUrl = normalizeOptionalString(row?.chapters_url);

  const inferredFeedHasImages = (
    isImageLikeMime(enclosureType)
    || isImageLikeUrl(enclosureUrl)
    || isImageLikeUrl(link)
  );
  const inferredFeedHasVideo = (
    isVideoLikeMime(enclosureType)
    || isVideoLikeUrl(enclosureUrl)
    || isVideoLikeUrl(link)
  );
  const inferredFeedHasLink = (
    enclosureUrl.length > 0
    || link.length > 0
    || transcriptUrl.length > 0
    || chaptersUrl.length > 0
  );

  return {
    hasImages: embeddedSignals.hasImages || explicitHasImages || inferredFeedHasImages,
    hasVideo: embeddedSignals.hasVideo || explicitHasVideo || inferredFeedHasVideo,
    hasLink: embeddedSignals.hasLink || explicitHasLink || inferredFeedHasLink,
    imageAltText,
    imageCount: Math.max(
      embeddedSignals.imageCount,
      explicitHasImages || inferredFeedHasImages ? 1 : 0,
    ),
  };
}

function fusedConfidence(row: any, options?: SearchOptions): number {
  const rrf = Number(row?.rrf_score ?? 0);
  const fts = Number(row?.fts_rank_raw ?? 0);
  const semanticDistance = Number(row?.semantic_distance ?? 1.2);
  const mediaSignals = deriveRowMediaSignals(row);

  const lexicalSignal = Number.isFinite(fts) ? Math.min(1, Math.max(0, fts)) : 0;
  const semanticSignal = Number.isFinite(semanticDistance)
    ? Math.min(1, Math.max(0, 1 - semanticDistance))
    : 0;
  const rrfSignal = Math.min(1, Math.max(0, rrf * 30));

  let blended = 0.45 * rrfSignal + 0.3 * lexicalSignal + 0.25 * semanticSignal;
  
  // Apply media boost if query has visual intent and post has images
  const visualIntent = options?.queryHasVisualIntent ?? false;
  const mediaBoost = getMediaBoostFactor(mediaSignals, visualIntent);
  
  blended = blended * mediaBoost;
  
  return Math.round(Math.max(0, Math.min(1, blended)) * 1000) / 1000;
}

function postProcessRows(rows: any[], options?: SearchOptions): any[] {
  return rows
    .map((row) => {
      const confidence = fusedConfidence(row, options);
      return {
        ...row,
        confidence_score: confidence,
        fused_score: Number(row?.rrf_score ?? 0) + confidence * 0.15,
      };
    })
    .sort((a, b) => Number(b.fused_score ?? 0) - Number(a.fused_score ?? 0));
}

export class HybridSearch {
  private queryVectorCache = new Map<string, CachedVector>();

  private evictCacheIfNeeded(): void {
    if (this.queryVectorCache.size <= QUERY_EMBED_CACHE_MAX) return;
    // Delete the first (least-recently-used) key. Because Map preserves insertion
    // order and we delete-then-reinsert on every cache hit, the first key is always
    // the LRU entry.
    const lruKey = this.queryVectorCache.keys().next().value;
    if (lruKey) this.queryVectorCache.delete(lruKey);
  }

  private cacheKeyForQuery(query: string, options: SearchOptions): string {
    const normalizedQuery = normalizeQueryForCache(query);
    const policyVersion = normalizePolicyVersion(options.policyVersion);
    const moderationHash = normalizeModerationHash(options.moderationProfileHash);
    return `${policyVersion}::${moderationHash}::${normalizedQuery}`;
  }

  private async getQueryEmbedding(query: string, options: SearchOptions = {}): Promise<number[]> {
    const key = this.cacheKeyForQuery(query, options);
    const now = Date.now();
    if (!options.disableCache) {
      const cached = this.queryVectorCache.get(key);
      if (cached && cached.expiresAt > now) {
        // Move to end to mark as most-recently-used.
        this.queryVectorCache.delete(key);
        this.queryVectorCache.set(key, cached);
        return cached.value;
      }
    }

    const embedding = await this.generateEmbedding(query, { mode: 'query' });
    if (!options.disableCache && embedding.length > 0) {
      this.queryVectorCache.delete(key); // remove stale entry if present
      this.queryVectorCache.set(key, { value: embedding, expiresAt: now + QUERY_EMBED_CACHE_TTL_MS });
      this.evictCacheIfNeeded();
    }
    return embedding;
  }

  /**
   * Generate a semantic embedding for a given text via the inference worker.
   */
  async generateEmbedding(text: string, options: { mode?: 'query' | 'ingest' | 'filter' } = {}): Promise<number[]> {
    const vector = await embeddingPipeline.embed(text, { mode: options.mode ?? 'query' });
    recordEmbeddingVector(options.mode ?? 'query', vector);
    return vector;
  }

  private async executeSemanticQuery(
    sql: string,
    params: unknown[],
    semanticCandidateCount: number,
  ) {
    const pg = paperDB.getPG();
    const efSearch = clampHnswEfSearch(semanticCandidateCount);

    try {
      return await pg.transaction(async (trx) => {
        await trx.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);
        return trx.query(sql, params);
      });
    } catch (error) {
      // Older pgvector builds or future transport changes should not break search
      // if per-query ef_search tuning is unavailable.
      if (!isEfSearchSettingError(error)) throw error;
      return pg.query(sql, params);
    }
  }

  /**
   * Perform a hybrid search using Reciprocal Rank Fusion (RRF).
   * RRF score = sum(1 / (k + rank)) across FTS and semantic rankings.
   */
  async search(query: string, limit = 20, options: SearchOptions = {}) {
    const resolvedLimit = normalizeSearchLimit(limit);
    const resolvedOptions: SearchOptions = {
      ...options,
      queryHasVisualIntent: options.queryHasVisualIntent ?? queryHasVisualIntent(query),
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * 2;

    const sql = `
      WITH fts_results AS (
        SELECT id,
               ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $1)) DESC) as rank
        FROM posts
        WHERE search_vector @@ plainto_tsquery('english', $1)
        LIMIT $2 * 2
      ),
      semantic_results AS (
        SELECT id,
               (embedding <=> $3::vector) AS semantic_distance,
               ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
        FROM posts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      )
      SELECT
        p.*,
        p.has_images,
        p.has_video,
        p.has_link,
        p.image_alt_text,
        COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) as rrf_score
      FROM posts p
      LEFT JOIN fts_results f ON p.id = f.id
      LEFT JOIN semantic_results s ON p.id = s.id
      WHERE f.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `;

    const result = await this.executeSemanticQuery(
      sql,
      [query, resolvedLimit, vectorStr, k],
      semanticCandidateLimit,
    );
    return {
      ...result,
      rows: postProcessRows(result.rows ?? [], resolvedOptions),
    };
  }

  /**
   * Search across both posts and feed items using hybrid search.
   */
  async searchAll(query: string, limit = 20, options: SearchOptions = {}) {
    const resolvedLimit = normalizeSearchLimit(limit);
    const resolvedOptions: SearchOptions = {
      ...options,
      queryHasVisualIntent: options.queryHasVisualIntent ?? queryHasVisualIntent(query),
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * 2;

    // Use indexed search_vector columns from each table rather than recomputing
    // to_tsvector inline. Ranks are computed globally across the merged union so
    // that RRF denominators are comparable between posts and feed_items.
    const sql = `
      WITH fts_candidates AS (
        SELECT id, 'post' AS type,
               ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS fts_rank_raw
        FROM posts
        WHERE search_vector @@ plainto_tsquery('english', $1)
        UNION ALL
        SELECT id, 'feed_item' AS type,
               ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS fts_rank_raw
        FROM feed_items
        WHERE search_vector @@ plainto_tsquery('english', $1)
      ),
      fts_results AS (
        SELECT id, type, fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY fts_rank_raw DESC) AS rank
        FROM fts_candidates
        LIMIT $2 * 2
      ),
      post_semantic_candidates AS (
        SELECT id, 'post' AS type,
               (embedding <=> $3::vector) AS semantic_distance
        FROM posts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      ),
      feed_item_semantic_candidates AS (
        SELECT id, 'feed_item' AS type,
               (embedding <=> $3::vector) AS semantic_distance
        FROM feed_items
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $3::vector ASC
        LIMIT $2 * 2
      ),
      semantic_candidates AS (
        SELECT * FROM post_semantic_candidates
        UNION ALL
        SELECT * FROM feed_item_semantic_candidates
      ),
      semantic_results AS (
        SELECT id, type, semantic_distance,
               ROW_NUMBER() OVER (ORDER BY semantic_distance ASC) AS rank
        FROM semantic_candidates
        LIMIT $2 * 2
      )
      SELECT
        COALESCE(f.id, s.id) AS id,
        COALESCE(f.type, s.type) AS item_type,
        p.embed,
        p.has_images,
        p.has_video,
        p.has_link,
        p.image_alt_text,
        fi.link,
        fi.enclosure_url,
        fi.enclosure_type,
        fi.transcript_url,
        fi.chapters_url,
        COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) AS rrf_score
      FROM fts_results f
      FULL OUTER JOIN semantic_results s ON f.id = s.id AND f.type = s.type
      LEFT JOIN posts p ON COALESCE(f.id, s.id) = p.id AND COALESCE(f.type, s.type) = 'post'
      LEFT JOIN feed_items fi ON COALESCE(f.id, s.id) = fi.id AND COALESCE(f.type, s.type) = 'feed_item'
      ORDER BY rrf_score DESC
      LIMIT $2;
    `;

    const result = await this.executeSemanticQuery(
      sql,
      [query, resolvedLimit, vectorStr, k],
      semanticCandidateLimit,
    );
    return {
      ...result,
      rows: postProcessRows(result.rows ?? [], resolvedOptions),
    };
  }

  /**
   * Search local feed items (including podcasts) with hybrid ranking.
   */
  async searchFeedItems(query: string, limit = 20, options: SearchOptions = {}) {
    const resolvedLimit = normalizeSearchLimit(limit);
    const resolvedOptions: SearchOptions = {
      ...options,
      queryHasVisualIntent: options.queryHasVisualIntent ?? queryHasVisualIntent(query),
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * 3;

    const sql = `
      WITH fts_results AS (
        SELECT fi.id,
               ts_rank_cd(fi.search_vector, plainto_tsquery('english', $1)) AS fts_rank_raw,
               ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(fi.search_vector, plainto_tsquery('english', $1)) DESC
        ) as rank
        FROM feed_items fi
        WHERE fi.search_vector @@ plainto_tsquery('english', $1)
        LIMIT $2 * 3
      ),
      semantic_results AS (
        SELECT fi.id,
               (fi.embedding <=> $3::vector) AS semantic_distance,
               ROW_NUMBER() OVER (ORDER BY fi.embedding <=> $3::vector ASC) as rank
        FROM feed_items fi
        WHERE fi.embedding IS NOT NULL
        ORDER BY fi.embedding <=> $3::vector ASC
        LIMIT $2 * 3
      )
      SELECT
        fi.id,
        fi.title,
        fi.content,
        fi.link,
        fi.pub_date,
        fi.author,
        fi.enclosure_url,
        fi.enclosure_type,
        fi.transcript_url,
        fi.chapters_url,
        fi.value_config,
        f.title AS feed_title,
        f.category AS feed_category,
        f.type AS feed_type,
        COALESCE(fr.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(sr.semantic_distance, 1.2) AS semantic_distance,
        COALESCE(1.0 / ($4 + fr.rank), 0.0) + COALESCE(1.0 / ($4 + sr.rank), 0.0) as rrf_score
      FROM feed_items fi
      LEFT JOIN feeds f ON fi.feed_id = f.id
      LEFT JOIN fts_results fr ON fi.id = fr.id
      LEFT JOIN semantic_results sr ON fi.id = sr.id
      WHERE fr.id IS NOT NULL OR sr.id IS NOT NULL
      ORDER BY rrf_score DESC, fi.pub_date DESC NULLS LAST
      LIMIT $2;
    `;

    const result = await this.executeSemanticQuery(
      sql,
      [query, resolvedLimit, vectorStr, k],
      semanticCandidateLimit,
    );
    return {
      ...result,
      rows: postProcessRows(result.rows ?? [], resolvedOptions),
    };
  }

  async getIndexHealthSnapshot() {
    const pg = paperDB.getPG();
    const [posts, feedItems] = await Promise.all([
      pg.query(
        `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM posts`,
      ),
      pg.query(
        `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_embedding FROM feed_items`,
      ),
    ]);

    const postRow = (posts.rows?.[0] ?? { total: 0, with_embedding: 0 }) as {
      total?: number | string;
      with_embedding?: number | string;
    };
    const feedRow = (feedItems.rows?.[0] ?? { total: 0, with_embedding: 0 }) as {
      total?: number | string;
      with_embedding?: number | string;
    };
    const postTotal = Number(postRow.total ?? 0);
    const postWithEmbedding = Number(postRow.with_embedding ?? 0);
    const feedTotal = Number(feedRow.total ?? 0);
    const feedWithEmbedding = Number(feedRow.with_embedding ?? 0);

    return {
      posts: {
        total: postTotal,
        withEmbedding: postWithEmbedding,
        coverage: postTotal > 0 ? postWithEmbedding / postTotal : 0,
      },
      feedItems: {
        total: feedTotal,
        withEmbedding: feedWithEmbedding,
        coverage: feedTotal > 0 ? feedWithEmbedding / feedTotal : 0,
      },
    };
  }
}

export const hybridSearch = new HybridSearch();
