/**
 * Timeout for search queries before fallback to vector-only.
 * Should be less than HTTP request timeout to allow graceful degradation.
 */
const DEFAULT_SEARCH_QUERY_TIMEOUT_MS = 7_000;

/**
 * Legacy parameter: kept for backward compatibility but now computed via exponential backoff.
 * Actual retry delay uses BackoffTimer with exponential growth.
 */
const DEFAULT_SEARCH_TIMEOUT_RETRY_DELAY_MS = 120;

const DEFAULT_RRF_WEIGHT = 0.45;
const DEFAULT_LEXICAL_WEIGHT = 0.30;
const DEFAULT_SEMANTIC_WEIGHT = 0.25;
const DEFAULT_CONFIDENCE_WEIGHT = 0.15;
const DEFAULT_SEMANTIC_CANDIDATE_MULTIPLIER = 2;
const DEFAULT_FEED_SEMANTIC_CANDIDATE_MULTIPLIER = 3;

/**
 * Query embedding cache TTL in milliseconds.
 * Configurable via VITE_SEARCH_QUERY_CACHE_TTL_MS environment variable.
 * Higher values reduce embedding generation but risk stale results.
 * Recommendation: 60-300 seconds for most use cases.
 */
const DEFAULT_QUERY_CACHE_TTL_MS = 60_000;

/**
 * Maximum query embedding cache size before LRU eviction.
 * Configurable via VITE_SEARCH_QUERY_CACHE_MAX environment variable.
 * Balance between hit rate and memory usage.
 */
const DEFAULT_QUERY_CACHE_MAX = 128;

function readImportMetaEnv(): Partial<ImportMetaEnv> {
  return ((import.meta as ImportMeta | undefined)?.env ?? {}) as Partial<ImportMetaEnv>;
}

function parseNonNegativeInteger(raw: string | undefined, defaultValue: number): number {
  if (typeof raw !== 'string') return defaultValue;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(0, Math.trunc(parsed));
}

function parseFloatInRange(raw: string | undefined, defaultValue: number, min: number, max: number): number {
  if (typeof raw !== 'string') return defaultValue;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalPositiveFloat(raw: string | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeWeightSet(weights: {
  rrfWeight: number;
  lexicalWeight: number;
  semanticWeight: number;
}): {
  rrfWeight: number;
  lexicalWeight: number;
  semanticWeight: number;
} {
  const total = weights.rrfWeight + weights.lexicalWeight + weights.semanticWeight;
  if (!Number.isFinite(total) || total <= 0) {
    return {
      rrfWeight: DEFAULT_RRF_WEIGHT,
      lexicalWeight: DEFAULT_LEXICAL_WEIGHT,
      semanticWeight: DEFAULT_SEMANTIC_WEIGHT,
    };
  }

  return {
    rrfWeight: weights.rrfWeight / total,
    lexicalWeight: weights.lexicalWeight / total,
    semanticWeight: weights.semanticWeight / total,
  };
}

export type HybridSearchRuntimeConfig = {
  queryTimeoutMs: number;
  timeoutRetryDelayMs: number; // Legacy; use exponential backoff instead
  rrfWeight: number;
  lexicalWeight: number;
  semanticWeight: number;
  confidenceWeight: number;
  semanticDistanceCutoff: number | null;
  semanticCandidateMultiplier: number;
  feedSemanticCandidateMultiplier: number;
  queryEmbedCacheTtlMs: number;
  queryEmbedCacheMax: number;
};

export function resolveHybridSearchRuntimeConfig(
  env: Partial<ImportMetaEnv> = readImportMetaEnv(),
): HybridSearchRuntimeConfig {
  const normalizedWeights = normalizeWeightSet({
    rrfWeight: parseFloatInRange(env.VITE_HYBRID_SEARCH_RRF_WEIGHT, DEFAULT_RRF_WEIGHT, 0, 1),
    lexicalWeight: parseFloatInRange(env.VITE_HYBRID_SEARCH_LEXICAL_WEIGHT, DEFAULT_LEXICAL_WEIGHT, 0, 1),
    semanticWeight: parseFloatInRange(env.VITE_HYBRID_SEARCH_SEMANTIC_WEIGHT, DEFAULT_SEMANTIC_WEIGHT, 0, 1),
  });

  return {
    queryTimeoutMs: parseNonNegativeInteger(
      env.VITE_HYBRID_SEARCH_QUERY_TIMEOUT_MS,
      DEFAULT_SEARCH_QUERY_TIMEOUT_MS,
    ),
    timeoutRetryDelayMs: parseNonNegativeInteger(
      env.VITE_HYBRID_SEARCH_TIMEOUT_RETRY_DELAY_MS,
      DEFAULT_SEARCH_TIMEOUT_RETRY_DELAY_MS,
    ),
    rrfWeight: normalizedWeights.rrfWeight,
    lexicalWeight: normalizedWeights.lexicalWeight,
    semanticWeight: normalizedWeights.semanticWeight,
    confidenceWeight: parseFloatInRange(
      env.VITE_HYBRID_SEARCH_CONFIDENCE_WEIGHT,
      DEFAULT_CONFIDENCE_WEIGHT,
      0,
      1,
    ),
    semanticDistanceCutoff: parseOptionalPositiveFloat(env.VITE_HYBRID_SEARCH_SEMANTIC_DISTANCE_CUTOFF),
    semanticCandidateMultiplier: Math.max(
      1,
      parseNonNegativeInteger(
        env.VITE_HYBRID_SEARCH_SEMANTIC_CANDIDATE_MULTIPLIER,
        DEFAULT_SEMANTIC_CANDIDATE_MULTIPLIER,
      ),
    ),
    feedSemanticCandidateMultiplier: Math.max(
      1,
      parseNonNegativeInteger(
        env.VITE_HYBRID_SEARCH_FEED_CANDIDATE_MULTIPLIER,
        DEFAULT_FEED_SEMANTIC_CANDIDATE_MULTIPLIER,
      ),
    ),
    queryEmbedCacheTtlMs: Math.max(
      1_000, // Minimum 1 second
      parseNonNegativeInteger(
        env.VITE_SEARCH_QUERY_CACHE_TTL_MS,
        DEFAULT_QUERY_CACHE_TTL_MS,
      ),
    ),
    queryEmbedCacheMax: Math.max(
      8, // Minimum 8 entries to avoid thrashing
      parseNonNegativeInteger(
        env.VITE_SEARCH_QUERY_CACHE_MAX,
        DEFAULT_QUERY_CACHE_MAX,
      ),
    ),
  };
}
