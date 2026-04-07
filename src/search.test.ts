import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  fallbackQueryMock,
  embedMock,
  recordEmbeddingVectorMock,
  getMediaBoostFactorMock,
  recordHybridSearchTimeoutFallbackMock,
  resolveHybridSearchRuntimeConfigMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  fallbackQueryMock: vi.fn(),
  embedMock: vi.fn(),
  recordEmbeddingVectorMock: vi.fn(),
  getMediaBoostFactorMock: vi.fn(() => 1),
  recordHybridSearchTimeoutFallbackMock: vi.fn(),
  resolveHybridSearchRuntimeConfigMock: vi.fn(() => ({
    queryTimeoutMs: 7_000,
    timeoutRetryDelayMs: 120,
    rrfWeight: 0.45,
    lexicalWeight: 0.30,
    semanticWeight: 0.25,
    confidenceWeight: 0.15,
    semanticDistanceCutoff: null,
    semanticCandidateMultiplier: 2,
    feedSemanticCandidateMultiplier: 3,
  })),
}));

vi.mock('./db', () => ({
  paperDB: {
    getPG: () => ({
      transaction: transactionMock,
      query: fallbackQueryMock,
    }),
  },
}));

vi.mock('./intelligence/embeddingPipeline', () => ({
  embeddingPipeline: {
    embed: embedMock,
  },
  sanitizeForEmbedding: (value: string) => value.trim(),
}));

vi.mock('./perf/embeddingTelemetry', () => ({
  recordEmbeddingVector: recordEmbeddingVectorMock,
}));

vi.mock('./perf/searchTelemetry', () => ({
  recordHybridSearchTimeoutFallback: recordHybridSearchTimeoutFallbackMock,
}));

vi.mock('./lib/media/extractMediaSignals', () => ({
  getMediaBoostFactor: getMediaBoostFactorMock,
  extractMediaSignalsFromJson: vi.fn(() => ({
    hasImages: false,
    hasVideo: false,
    hasLink: false,
    imageAltText: '',
    imageCount: 0,
  })),
}));

vi.mock('./search/runtime', () => ({
  resolveHybridSearchRuntimeConfig: resolveHybridSearchRuntimeConfigMock,
}));

import { hybridSearch, HybridSearch } from './search';

describe('HybridSearch semantic query execution', () => {
  beforeEach(() => {
    transactionMock.mockReset();
    fallbackQueryMock.mockReset();
    embedMock.mockReset();
    recordEmbeddingVectorMock.mockReset();
    getMediaBoostFactorMock.mockClear();
    recordHybridSearchTimeoutFallbackMock.mockReset();
    resolveHybridSearchRuntimeConfigMock.mockClear();
    embedMock.mockResolvedValue([0.12, 0.34, 0.56]);
  });

  it('shapes cross-table semantic search so pgvector indexes can participate', async () => {
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    await hybridSearch.searchAll('climate signal', 20, { disableCache: true });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(trxQueryMock).toHaveBeenCalledTimes(2);
    expect(trxQueryMock.mock.calls[0]?.[0]).toBe('SET LOCAL hnsw.ef_search = 40');

    const executedSql = String(trxQueryMock.mock.calls[1]?.[0] ?? '');
    expect(executedSql).toContain("websearch_to_tsquery('english', $1)");
    expect(executedSql).toContain('post_semantic_candidates');
    expect(executedSql).toContain('feed_item_semantic_candidates');
    expect(executedSql).toContain('ORDER BY embedding <=> $3::vector ASC');
    expect(executedSql).toContain('LIMIT $2 * 2');
  });

  it('falls back to a plain query if per-query ef_search tuning is unavailable', async () => {
    transactionMock.mockRejectedValue(new Error('unrecognized configuration parameter "hnsw.ef_search"'));
    fallbackQueryMock.mockResolvedValue({ rows: [] });

    await hybridSearch.search('fallback coverage', 20, { disableCache: true });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(fallbackQueryMock).toHaveBeenCalledTimes(1);
  });

  it('retries via plain query when semantic transaction path times out', async () => {
    const timeoutTolerantSearch = new HybridSearch({
      queryTimeoutMs: 1,
      timeoutRetryDelayMs: 0,
    });

    transactionMock.mockImplementation(() => new Promise(() => {}));
    fallbackQueryMock.mockResolvedValue({ rows: [] });

    await timeoutTolerantSearch.search('timeout fallback', 20, { disableCache: true });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(fallbackQueryMock).toHaveBeenCalledTimes(1);
    expect(recordHybridSearchTimeoutFallbackMock).toHaveBeenCalledWith({
      scope: 'search',
      retryDelayMs: 0,
      timeoutMs: 1,
    });
  });

  it('uses central runtime config defaults for timeout fallback telemetry', async () => {
    resolveHybridSearchRuntimeConfigMock.mockReturnValueOnce({
      queryTimeoutMs: 2,
      timeoutRetryDelayMs: 0,
      rrfWeight: 0.45,
      lexicalWeight: 0.30,
      semanticWeight: 0.25,
      confidenceWeight: 0.15,
      semanticDistanceCutoff: null,
      semanticCandidateMultiplier: 2,
      feedSemanticCandidateMultiplier: 3,
    });

    const configuredSearch = new HybridSearch();
    transactionMock.mockImplementation(() => new Promise(() => {}));
    fallbackQueryMock.mockResolvedValue({ rows: [] });

    await configuredSearch.search('config timeout fallback', 20, { disableCache: true });

    expect(recordHybridSearchTimeoutFallbackMock).toHaveBeenCalledWith({
      scope: 'search',
      retryDelayMs: 0,
      timeoutMs: 2,
    });
  });

  it('applies visual-intent media scoring to local feed item search results', async () => {
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'feed-visual',
            title: 'Screenshot breakdown',
            link: 'https://example.com/episode',
            enclosure_type: 'image/jpeg',
            rrf_score: 0.3,
            fts_rank_raw: 0.4,
            semantic_distance: 0.2,
          },
        ],
      });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));
    getMediaBoostFactorMock.mockReturnValue(1.18);

    const result = await hybridSearch.searchFeedItems('screenshot workflow', 10, { disableCache: true });

    expect(getMediaBoostFactorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hasImages: true,
        hasVideo: false,
        hasLink: true,
      }),
      true,
    );
    expect(result.rows[0]?.fused_score).toBeGreaterThan(0.3);
  });

  it('filters weak semantic matches using semantic distance cutoff while keeping lexical-only rows', async () => {
    const cutoffSearch = new HybridSearch({ semanticDistanceCutoff: 0.6 });

    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'semantic-weak',
            rrf_score: 0.7,
            fts_rank_raw: 0,
            semantic_distance: 0.95,
            semantic_matched: 1,
          },
          {
            id: 'lexical-strong',
            rrf_score: 0.4,
            fts_rank_raw: 0.3,
            semantic_distance: 1.2,
            semantic_matched: 0,
          },
        ],
      });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    const result = await cutoffSearch.search('cutoff behavior', 10, { disableCache: true });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe('lexical-strong');
  });

  it('uses feed candidate multiplier from runtime config to tune ef_search', async () => {
    resolveHybridSearchRuntimeConfigMock.mockReturnValueOnce({
      queryTimeoutMs: 7_000,
      timeoutRetryDelayMs: 120,
      rrfWeight: 0.45,
      lexicalWeight: 0.30,
      semanticWeight: 0.25,
      confidenceWeight: 0.15,
      semanticDistanceCutoff: null,
      semanticCandidateMultiplier: 2,
      feedSemanticCandidateMultiplier: 5,
    });

    const tunedSearch = new HybridSearch();
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    await tunedSearch.searchFeedItems('candidate tuning', 20, { disableCache: true });
    expect(trxQueryMock.mock.calls[0]?.[0]).toBe('SET LOCAL hnsw.ef_search = 100');
  });
});
