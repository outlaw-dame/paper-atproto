// ─── Hybrid Search ────────────────────────────────────────────────────────
// Combines Full-Text Search (FTS) and Semantic Search using Reciprocal Rank
// Fusion (RRF). Runs entirely in the browser using PGlite + pgvector.
//
// Embeddings are generated via the inference worker (off main thread).
// This module no longer imports from @xenova/transformers directly.
// Recovery: Implements exponential backoff, circuit breaker, and connection health monitoring.

import { paperDB } from './db';
import { embeddingPipeline, sanitizeForEmbedding } from './intelligence/embeddingPipeline';
import {
  chooseIntelligenceLane,
  evaluateLocalSearchQuality,
  type DataScope,
  type IntelligenceRoutingInput,
  type IntelligenceTask,
  type LocalSearchQuality,
  type PrivacyMode,
} from './intelligence/intelligenceRoutingPolicy';
import { recordEmbeddingVector } from './perf/embeddingTelemetry';
import { recordHybridSearchTimeoutFallback } from './perf/searchTelemetry';
import {
  extractMediaSignalsFromJson,
  getMediaBoostFactor,
  type MediaSignals,
} from './lib/media/extractMediaSignals';
import { detectVisualIntent } from './lib/searchIntent';
import { resolveHybridSearchRuntimeConfig } from './search/runtime';
import { BackoffTimer, SEARCH_BACKOFF_CONFIG } from './lib/backoffStrategy';
import { CircuitBreaker, DB_CIRCUIT_BREAKER_CONFIG, ConnectionHealthMonitor } from './lib/circuitBreaker';

interface SearchOptions {
  policyVersion?: string;
  moderationProfileHash?: string;
  disableCache?: boolean;
  queryHasVisualIntent?: boolean; // NEW: for media-aware ranking
  semanticDistanceCutoff?: number | null;
  rrfWeight?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  confidenceWeight?: number;
  privacyMode?: PrivacyMode;
  dataScope?: DataScope;
  localSmallMlAvailable?: boolean;
  edgeAvailable?: boolean;
  localIndexCoverage?: number | null;
}

interface CachedVector {
  value: number[];
  expiresAt: number;
}

const QUERY_EMBED_CACHE_TTL_MS_LEGACY = 60_000;
const QUERY_EMBED_CACHE_MAX_LEGACY = 128;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

class HybridSearchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HybridSearchTimeoutError';
  }
}

interface HybridSearchRuntimeOptions {
  queryTimeoutMs?: number;
  timeoutRetryDelayMs?: number;
  semanticDistanceCutoff?: number | null;
}

type FusionWeights = {
  rrfWeight: number;
  lexicalWeight: number;
  semanticWeight: number;
  confidenceWeight: number;
};

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

function isQueryTimeoutError(error: unknown): boolean {
  return error instanceof HybridSearchTimeoutError;
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return detectVisualIntent(query);
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

function fusedConfidence(row: any, options: SearchOptions | undefined, weights: FusionWeights): number {
  const rrf = Number(row?.rrf_score ?? 0);
  const fts = Number(row?.fts_rank_raw ?? 0);
  const semanticDistance = Number(row?.semantic_distance ?? 1.2);
  const mediaSignals = deriveRowMediaSignals(row);

  const lexicalSignal = Number.isFinite(fts) ? Math.min(1, Math.max(0, fts)) : 0;
  const semanticSignal = Number.isFinite(semanticDistance)
    ? Math.min(1, Math.max(0, 1 - semanticDistance))
    : 0;
  const rrfSignal = Math.min(1, Math.max(0, rrf * 30));

  let blended = (
    weights.rrfWeight * rrfSignal
    + weights.lexicalWeight * lexicalSignal
    + weights.semanticWeight * semanticSignal
  );
  
  // Apply media boost if query has visual intent and post has images
  const visualIntent = options?.queryHasVisualIntent ?? false;
  const mediaBoost = getMediaBoostFactor(mediaSignals, visualIntent);
  
  blended = blended * mediaBoost;
  
  return Math.round(Math.max(0, Math.min(1, blended)) * 1000) / 1000;
}

function postProcessRows(rows: any[], options?: SearchOptions): any[] {
  const fusionWeights: FusionWeights = {
    rrfWeight: Number(options?.rrfWeight ?? 0.45),
    lexicalWeight: Number(options?.lexicalWeight ?? 0.30),
    semanticWeight: Number(options?.semanticWeight ?? 0.25),
    confidenceWeight: Number(options?.confidenceWeight ?? 0.15),
  };

  const semanticDistanceCutoff = (
    Number.isFinite(options?.semanticDistanceCutoff)
      ? Math.max(0, Number(options?.semanticDistanceCutoff))
      : null
  );

  return rows
    .filter((row) => {
      if (semanticDistanceCutoff === null) return true;
      const semanticMatched = Number(row?.semantic_matched ?? 0) === 1;
      if (!semanticMatched) return true;
      const semanticDistance = Number(row?.semantic_distance ?? Number.POSITIVE_INFINITY);
      return semanticDistance <= semanticDistanceCutoff;
    })
    .map((row) => {
      const confidence = fusedConfidence(row, options, fusionWeights);
      return {
        ...row,
        confidence_score: confidence,
        fused_score: Number(row?.rrf_score ?? 0) + confidence * fusionWeights.confidenceWeight,
      };
    })
    .sort((a, b) => Number(b.fused_score ?? 0) - Number(a.fused_score ?? 0));
}

function buildSearchRoutingInput(input: {
  task: IntelligenceTask;
  dataScope: DataScope;
  options: SearchOptions;
  localSearchQuality: LocalSearchQuality;
}): IntelligenceRoutingInput {
  return {
    task: input.task,
    dataScope: input.dataScope,
    localSearchQuality: input.localSearchQuality,
    ...(input.options.privacyMode ? { privacyMode: input.options.privacyMode } : {}),
    ...(typeof input.options.localSmallMlAvailable === 'boolean'
      ? { localSmallMlAvailable: input.options.localSmallMlAvailable }
      : {}),
    ...(typeof input.options.edgeAvailable === 'boolean'
      ? { edgeAvailable: input.options.edgeAvailable }
      : {}),
  };
}

function finalizeSearchResult(
  result: any,
  rows: any[],
  input: {
    limit: number;
    task: IntelligenceTask;
    fallbackDataScope: DataScope;
    options: SearchOptions;
  },
): any {
  const dataScope = input.options.dataScope ?? input.fallbackDataScope;
  const localSearchQuality = evaluateLocalSearchQuality({
    rows,
    resultLimit: input.limit,
    localIndexCoverage: input.options.localIndexCoverage ?? null,
  });
  const intelligenceRouting = chooseIntelligenceLane(buildSearchRoutingInput({
    task: input.task,
    dataScope,
    options: input.options,
    localSearchQuality,
  }));

  return {
    ...result,
    rows,
    localSearchQuality,
    intelligenceRouting,
  };
}

export class HybridSearch {
  private readonly resolvedRuntimeConfig: ReturnType<typeof resolveHybridSearchRuntimeConfig>;
  private readonly backoffTimer: BackoffTimer;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly healthMonitor: ConnectionHealthMonitor;

  constructor(private readonly runtimeOptions: HybridSearchRuntimeOptions = {}) {
    this.resolvedRuntimeConfig = resolveHybridSearchRuntimeConfig();
    this.backoffTimer = new BackoffTimer(SEARCH_BACKOFF_CONFIG);
    this.circuitBreaker = new CircuitBreaker(DB_CIRCUIT_BREAKER_CONFIG);
    this.healthMonitor = new ConnectionHealthMonitor(
      () => this.performConnectionHealthCheck(),
      (healthy) => this.onConnectionHealthChange(healthy),
      30_000, // Check every 30 seconds
    );
  }

  private get queryTimeoutMs(): number {
    const configured = this.runtimeOptions.queryTimeoutMs;
    if (!Number.isFinite(configured) || configured === undefined) {
      return this.resolvedRuntimeConfig.queryTimeoutMs;
    }
    return Math.max(0, Math.trunc(configured));
  }

  private get timeoutRetryDelayMs(): number {
    const configured = this.runtimeOptions.timeoutRetryDelayMs;
    if (!Number.isFinite(configured) || configured === undefined) {
      return this.resolvedRuntimeConfig.timeoutRetryDelayMs;
    }
    return Math.max(0, Math.trunc(configured));
  }

  private get semanticDistanceCutoff(): number | null {
    const configured = this.runtimeOptions.semanticDistanceCutoff;
    if (Number.isFinite(configured)) {
      return Math.max(0, Number(configured));
    }
    return this.resolvedRuntimeConfig.semanticDistanceCutoff;
  }

  private get semanticCandidateMultiplier(): number {
    return this.resolvedRuntimeConfig.semanticCandidateMultiplier;
  }

  private get feedSemanticCandidateMultiplier(): number {
    return this.resolvedRuntimeConfig.feedSemanticCandidateMultiplier;
  }

  private async withQueryTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    if (this.queryTimeoutMs <= 0) return promise;

    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new HybridSearchTimeoutError(message));
      }, this.queryTimeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }

  private queryVectorCache = new Map<string, CachedVector>();

  private evictCacheIfNeeded(): void {
    const maxCacheSize = this.resolvedRuntimeConfig.queryEmbedCacheMax;
    if (this.queryVectorCache.size <= maxCacheSize) return;
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
    const cacheTtlMs = this.resolvedRuntimeConfig.queryEmbedCacheTtlMs;

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
      this.queryVectorCache.set(key, { value: embedding, expiresAt: now + cacheTtlMs });
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
   * Perform health check on database connection.
   * Returns true if connection is healthy, false otherwise.
   */
  private async performConnectionHealthCheck(): Promise<boolean> {
    try {
      const pg = paperDB.getPG();
      // Simple query to check connection viability
      await Promise.race([
        pg.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.queryTimeoutMs / 2)
        ),
      ]);
      return true;
    } catch (error) {
      console.debug('[HybridSearch] Connection health check failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Callback when connection health status changes.
   */
  private onConnectionHealthChange(healthy: boolean): void {
    if (!healthy) {
      console.warn('[HybridSearch] Database connection degraded; circuit breaker may activate');
    } else {
      console.debug('[HybridSearch] Database connection restored');
    }
  }

  /**
   * Start health monitoring for the database connection.
   */
  startHealthMonitoring(): void {
    this.healthMonitor.start();
  }

  /**
   * Stop health monitoring.
   */
  stopHealthMonitoring(): void {
    this.healthMonitor.stop();
  }

  /**
   * Get current circuit breaker metrics for debugging.
   */
  getCircuitBreakerMetrics() {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Reset circuit breaker (for testing or manual recovery).
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  private async executeSemanticQuery(
    sql: string,
    params: unknown[],
    semanticCandidateCount: number,
    scope: 'search' | 'searchAll' | 'searchFeedItems',
  ) {
    const pg = paperDB.getPG();
    const efSearch = clampHnswEfSearch(semanticCandidateCount);

    try {
      return await this.circuitBreaker.execute(
        () => this.withQueryTimeout(
          pg.transaction(async (trx) => {
            await trx.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);
            return trx.query(sql, params);
          }),
          `Hybrid search transaction timed out after ${this.queryTimeoutMs}ms`,
        ),
        `[HybridSearch] ${scope} semantic query execution`,
      );
    } catch (error) {
      // Older pgvector builds or future transport changes should not break search
      // if per-query ef_search tuning is unavailable.
      if (isEfSearchSettingError(error)) {
        return await this.withQueryTimeout(
          pg.query(sql, params),
          `Hybrid search fallback query timed out after ${this.queryTimeoutMs}ms`,
        );
      }

      // If transaction execution timed out, retry once with exponential backoff.
      // This avoids failing hard on transient worker stalls.
      if (isQueryTimeoutError(error)) {
        recordHybridSearchTimeoutFallback({
          scope,
          retryDelayMs: this.timeoutRetryDelayMs,
          timeoutMs: this.queryTimeoutMs,
        });
        // Use exponential backoff with small delay for search workload
        await sleep(50 + Math.random() * 100);
        return await this.withQueryTimeout(
          pg.query(sql, params),
          `Hybrid search retry timed out after ${this.queryTimeoutMs}ms`,
        );
      }

      throw error;
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
      semanticDistanceCutoff: options.semanticDistanceCutoff ?? this.semanticDistanceCutoff,
      rrfWeight: this.resolvedRuntimeConfig.rrfWeight,
      lexicalWeight: this.resolvedRuntimeConfig.lexicalWeight,
      semanticWeight: this.resolvedRuntimeConfig.semanticWeight,
      confidenceWeight: this.resolvedRuntimeConfig.confidenceWeight,
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * this.semanticCandidateMultiplier;

    const sql = `
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', $1) AS q
      ),
      fts_results AS (
        SELECT id,
               ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, query_terms.q, 32) DESC) as rank
        FROM posts
        CROSS JOIN query_terms
        WHERE search_vector @@ query_terms.q
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
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
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
      'search',
    );
    const rows = postProcessRows(result.rows ?? [], resolvedOptions);
    return finalizeSearchResult(result, rows, {
      limit: resolvedLimit,
      task: 'local_search',
      fallbackDataScope: 'local_cache',
      options: resolvedOptions,
    });
  }

  /**
   * Search across both posts and feed items using hybrid search.
   */
  async searchAll(query: string, limit = 20, options: SearchOptions = {}) {
    const resolvedLimit = normalizeSearchLimit(limit);
    const resolvedOptions: SearchOptions = {
      ...options,
      queryHasVisualIntent: options.queryHasVisualIntent ?? queryHasVisualIntent(query),
      semanticDistanceCutoff: options.semanticDistanceCutoff ?? this.semanticDistanceCutoff,
      rrfWeight: this.resolvedRuntimeConfig.rrfWeight,
      lexicalWeight: this.resolvedRuntimeConfig.lexicalWeight,
      semanticWeight: this.resolvedRuntimeConfig.semanticWeight,
      confidenceWeight: this.resolvedRuntimeConfig.confidenceWeight,
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * this.semanticCandidateMultiplier;

    // Use indexed search_vector columns from each table rather than recomputing
    // to_tsvector inline. Ranks are computed globally across the merged union so
    // that RRF denominators are comparable between posts and feed_items.
    const sql = `
          WITH query_terms AS (
       SELECT websearch_to_tsquery('english', $1) AS q
          ),
          fts_candidates AS (
        SELECT id, 'post' AS type,
         ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw
        FROM posts
       CROSS JOIN query_terms
       WHERE search_vector @@ query_terms.q
        UNION ALL
        SELECT id, 'feed_item' AS type,
         ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw
        FROM feed_items
       CROSS JOIN query_terms
       WHERE search_vector @@ query_terms.q
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
        CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
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
      'searchAll',
    );
    const rows = postProcessRows(result.rows ?? [], resolvedOptions);
    return finalizeSearchResult(result, rows, {
      limit: resolvedLimit,
      task: 'public_search',
      fallbackDataScope: 'public_corpus',
      options: resolvedOptions,
    });
  }

  /**
   * Search local feed items (including podcasts) with hybrid ranking.
   */
  async searchFeedItems(query: string, limit = 20, options: SearchOptions = {}) {
    const resolvedLimit = normalizeSearchLimit(limit);
    const resolvedOptions: SearchOptions = {
      ...options,
      queryHasVisualIntent: options.queryHasVisualIntent ?? queryHasVisualIntent(query),
      semanticDistanceCutoff: options.semanticDistanceCutoff ?? this.semanticDistanceCutoff,
      rrfWeight: this.resolvedRuntimeConfig.rrfWeight,
      lexicalWeight: this.resolvedRuntimeConfig.lexicalWeight,
      semanticWeight: this.resolvedRuntimeConfig.semanticWeight,
      confidenceWeight: this.resolvedRuntimeConfig.confidenceWeight,
    };
    const queryEmbedding = await this.getQueryEmbedding(query, resolvedOptions);
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const k = 60;
    const semanticCandidateLimit = resolvedLimit * this.feedSemanticCandidateMultiplier;

    const sql = `
      WITH query_terms AS (
        SELECT websearch_to_tsquery('english', $1) AS q
      ),
      fts_results AS (
        SELECT fi.id,
               ts_rank_cd(fi.search_vector, query_terms.q, 32) AS fts_rank_raw,
               ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(fi.search_vector, query_terms.q, 32) DESC
        ) as rank
        FROM feed_items fi
        CROSS JOIN query_terms
        WHERE fi.search_vector @@ query_terms.q
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
        CASE WHEN sr.id IS NOT NULL THEN 1 ELSE 0 END AS semantic_matched,
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
      'searchFeedItems',
    );
    const rows = postProcessRows(result.rows ?? [], resolvedOptions);
    return finalizeSearchResult(result, rows, {
      limit: resolvedLimit,
      task: 'local_search',
      fallbackDataScope: 'local_cache',
      options: resolvedOptions,
    });
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
