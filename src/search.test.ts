import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  fallbackQueryMock,
  generateEmbeddingMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  fallbackQueryMock: vi.fn(),
  generateEmbeddingMock: vi.fn(),
}));

const { paperDB } = await import('./db');
const {
  getHybridSearchTelemetrySnapshot,
  resetSearchTelemetryForTests,
} = await import('./perf/searchTelemetry');
const { hybridSearch, HybridSearch } = await import('./search');

describe('HybridSearch semantic query execution', () => {
  beforeEach(() => {
    transactionMock.mockReset();
    fallbackQueryMock.mockReset();
    generateEmbeddingMock.mockReset();
    resetSearchTelemetryForTests();
    generateEmbeddingMock.mockResolvedValue([0.12, 0.34, 0.56]);
    vi.spyOn(HybridSearch.prototype, 'generateEmbedding').mockImplementation(generateEmbeddingMock);
    vi.spyOn(paperDB, 'getPG').mockReturnValue({
      transaction: transactionMock,
      query: fallbackQueryMock,
    } as unknown as ReturnType<typeof paperDB.getPG>);
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
    expect(getHybridSearchTelemetrySnapshot().lastTimeoutFallback).toMatchObject({
      scope: 'search',
      retryDelayMs: 0,
      timeoutMs: 1,
    });
  });

  it('uses configured timeout fallback telemetry', async () => {
    const configuredSearch = new HybridSearch({
      queryTimeoutMs: 2,
      timeoutRetryDelayMs: 0,
    });
    transactionMock.mockImplementation(() => new Promise(() => {}));
    fallbackQueryMock.mockResolvedValue({ rows: [] });

    await configuredSearch.search('config timeout fallback', 20, { disableCache: true });

    expect(getHybridSearchTelemetrySnapshot().lastTimeoutFallback).toMatchObject({
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
    const result = await hybridSearch.searchFeedItems('screenshot workflow', 10, { disableCache: true });

    expect(result.rows[0]?.fused_score).toBeGreaterThan(0.3);
  });

  it('keeps local-cache searches on the local browser small-ML lane when edge availability is omitted', async () => {
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'weak-local-result',
            rrf_score: 0.02,
            fts_rank_raw: 0,
            semantic_distance: 0.96,
            semantic_matched: 1,
          },
        ],
      });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    const result = await hybridSearch.search('private-ish local cache query', 10, { disableCache: true });

    expect(result.localSearchQuality.confidence).toBeLessThan(0.48);
    expect(result.intelligenceRouting).toMatchObject({
      lane: 'browser_small_ml',
      reasonCode: 'browser_small_ml_default',
      sendsPrivateText: false,
    });
    expect(result.intelligenceRouting.fallbackLane).toBeUndefined();
  });

  it('allows explicit edge availability to escalate low-confidence local-cache search', async () => {
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'weak-edge-eligible-result',
            rrf_score: 0.02,
            fts_rank_raw: 0,
            semantic_distance: 0.96,
            semantic_matched: 1,
          },
        ],
      });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    const result = await hybridSearch.search('public-ish local cache query', 10, {
      disableCache: true,
      edgeAvailable: true,
    });

    expect(result.localSearchQuality.confidence).toBeLessThan(0.48);
    expect(result.intelligenceRouting).toMatchObject({
      lane: 'edge_reranker',
      fallbackLane: 'browser_small_ml',
      reasonCode: 'edge_reranker_low_local_quality',
      sendsPrivateText: false,
    });
  });

  it('defaults private-corpus search to local-only routing even when edge availability is omitted', async () => {
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'weak-private-result',
            rrf_score: 0.01,
            fts_rank_raw: 0,
            semantic_distance: 0.99,
            semantic_matched: 1,
          },
        ],
      });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    const result = await hybridSearch.search('private library query', 10, {
      disableCache: true,
      dataScope: 'private_corpus',
    });

    expect(result.intelligenceRouting).toMatchObject({
      lane: 'browser_small_ml',
      reasonCode: 'browser_small_ml_private_search',
      sendsPrivateText: false,
    });
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

  it('uses feed candidate multiplier from runtime defaults to tune ef_search', async () => {
    const tunedSearch = new HybridSearch();
    const trxQueryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    transactionMock.mockImplementation(async (callback: (trx: { query: typeof trxQueryMock }) => Promise<unknown>) => (
      callback({ query: trxQueryMock })
    ));

    await tunedSearch.searchFeedItems('candidate tuning', 20, { disableCache: true });
    expect(trxQueryMock.mock.calls[0]?.[0]).toBe('SET LOCAL hnsw.ef_search = 60');
  });
});
