// ─── Hybrid Search ────────────────────────────────────────────────────────
// Combines Full-Text Search (FTS) and Semantic Search using Reciprocal Rank
// Fusion (RRF). Runs entirely in the browser using PGlite + pgvector.
//
// Embeddings are generated via the inference worker (off main thread).
// This module no longer imports from @xenova/transformers directly.

import { paperDB } from './db';
import { embeddingPipeline, sanitizeForEmbedding } from './intelligence/embeddingPipeline';
import { recordEmbeddingVector } from './perf/embeddingTelemetry';
import { getMediaBoostFactor } from './lib/media/extractMediaSignals';

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
    'meme', 'screenshot', 'screenshot', 'video', 'image', 'photo', 'picture',
    'illustration', 'chart', 'graph', 'diagram', 'visual', 'design', 'art',
    'artwork', 'drawing', 'sketch', 'appearance', 'looks', 'see', 'watch',
  ];
  const normalizedQuery = query.toLowerCase();
  return visualKeywords.some(keyword => normalizedQuery.includes(keyword));
}

function fusedConfidence(row: any, options?: SearchOptions): number {
  const rrf = Number(row?.rrf_score ?? 0);
  const fts = Number(row?.fts_rank_raw ?? 0);
  const semanticDistance = Number(row?.semantic_distance ?? 1.2);
  const hasImages = Number(row?.has_images ?? 0) === 1;

  const lexicalSignal = Number.isFinite(fts) ? Math.min(1, Math.max(0, fts)) : 0;
  const semanticSignal = Number.isFinite(semanticDistance)
    ? Math.min(1, Math.max(0, 1 - semanticDistance))
    : 0;
  const rrfSignal = Math.min(1, Math.max(0, rrf * 30));

  let blended = 0.45 * rrfSignal + 0.3 * lexicalSignal + 0.25 * semanticSignal;
  
  // Apply media boost if query has visual intent and post has images
  const visualIntent = options?.queryHasVisualIntent ?? false;
  const mediaBoost = getMediaBoostFactor({ 
    hasImages, 
    hasVideo: Number(row?.has_video ?? 0) === 1,
    hasLink: Number(row?.has_link ?? 0) === 1,
    imageCount: 1,
    imageAltText: row?.image_alt_text ?? '',
  }, visualIntent);
  
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
    const oldestKey = this.queryVectorCache.keys().next().value;
    if (oldestKey) this.queryVectorCache.delete(oldestKey);
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
        return cached.value;
      }
    }

    const embedding = await this.generateEmbedding(query, { mode: 'query' });
    if (!options.disableCache && embedding.length > 0) {
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

  /**
   * Perform a hybrid search using Reciprocal Rank Fusion (RRF).
   * RRF score = sum(1 / (k + rank)) across FTS and semantic rankings.
   */
  async search(query: string, limit = 20, options: SearchOptions = {}) {
    const pg = paperDB.getPG();
    const queryEmbedding = await this.getQueryEmbedding(query, options);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    
    // Detect visual intent in query for media-aware ranking
    if (!options.queryHasVisualIntent) {
      options.queryHasVisualIntent = queryHasVisualIntent(query);
    }

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

    const result = await pg.query(sql, [query, limit, vectorStr, k]);
    return {
      ...result,
      rows: postProcessRows(result.rows ?? [], options),
    };
  }

  /**
   * Search across both posts and feed items using hybrid search.
   */
  async searchAll(query: string, limit = 20, options: SearchOptions = {}) {
    const pg = paperDB.getPG();
    const queryEmbedding = await this.getQueryEmbedding(query, options);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;

    const sql = `
      WITH combined_items AS (
        SELECT id, content as text, 'post' as type FROM posts
        UNION ALL
        SELECT id, title || ' ' || coalesce(content, '') as text, 'feed_item' as type FROM feed_items
      ),
      fts_results AS (
        SELECT id,
               type,
               ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) AS fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) DESC) as rank
        FROM combined_items
        WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
        LIMIT $2 * 2
      ),
      semantic_results AS (
        (
          SELECT id,
                 'post' as type,
                 (embedding <=> $3::vector) AS semantic_distance,
                 ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
          FROM posts WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $3::vector ASC
          LIMIT $2 * 2
        )
        UNION ALL
        (
          SELECT id,
                 'feed_item' as type,
                 (embedding <=> $3::vector) AS semantic_distance,
                 ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector ASC) as rank
          FROM feed_items WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $3::vector ASC
          LIMIT $2 * 2
        )
      )
      SELECT
        ci.id,
        ci.text as content,
        COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
        COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
        COALESCE(1.0 / ($4 + f.rank), 0.0) + COALESCE(1.0 / ($4 + s.rank), 0.0) as rrf_score,
        ci.type as item_type
      FROM combined_items ci
      LEFT JOIN fts_results f ON ci.id = f.id AND ci.type = f.type
      LEFT JOIN semantic_results s ON ci.id = s.id AND ci.type = s.type
      WHERE f.id IS NOT NULL OR s.id IS NOT NULL
      ORDER BY rrf_score DESC
      LIMIT $2;
    `;

    const result = await pg.query(sql, [query, limit, vectorStr, k]);
    return {
      ...result,
      rows: postProcessRows(result.rows ?? [], options),
    };
  }

  /**
   * Search local feed items (including podcasts) with hybrid ranking.
   */
  async searchFeedItems(query: string, limit = 20, options: SearchOptions = {}) {
    const pg = paperDB.getPG();
    const queryEmbedding = await this.getQueryEmbedding(query, options);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;

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

    const result = await pg.query(sql, [query, limit, vectorStr, k]);
    return {
      ...result,
      rows: postProcessRows(result.rows ?? []),
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
