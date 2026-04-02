import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  fallbackQueryMock,
  embedMock,
  recordEmbeddingVectorMock,
  getMediaBoostFactorMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  fallbackQueryMock: vi.fn(),
  embedMock: vi.fn(),
  recordEmbeddingVectorMock: vi.fn(),
  getMediaBoostFactorMock: vi.fn(() => 1),
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

import { hybridSearch } from './search';

describe('HybridSearch semantic query execution', () => {
  beforeEach(() => {
    transactionMock.mockReset();
    fallbackQueryMock.mockReset();
    embedMock.mockReset();
    recordEmbeddingVectorMock.mockReset();
    getMediaBoostFactorMock.mockClear();
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
});
