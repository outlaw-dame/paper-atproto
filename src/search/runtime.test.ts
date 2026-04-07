import { describe, expect, it } from 'vitest';
import { resolveHybridSearchRuntimeConfig } from './runtime';

describe('resolveHybridSearchRuntimeConfig', () => {
  it('uses defaults when env values are missing', () => {
    expect(resolveHybridSearchRuntimeConfig({})).toEqual({
      queryTimeoutMs: 7_000,
      timeoutRetryDelayMs: 120,
      rrfWeight: 0.45,
      lexicalWeight: 0.3,
      semanticWeight: 0.25,
      confidenceWeight: 0.15,
      semanticDistanceCutoff: null,
      semanticCandidateMultiplier: 2,
      feedSemanticCandidateMultiplier: 3,
      queryEmbedCacheTtlMs: 60_000,
      queryEmbedCacheMax: 128,
    });
  });

  it('reads env overrides and normalizes negative/invalid values', () => {
    expect(
      resolveHybridSearchRuntimeConfig({
        VITE_HYBRID_SEARCH_QUERY_TIMEOUT_MS: '2500',
        VITE_HYBRID_SEARCH_TIMEOUT_RETRY_DELAY_MS: '40',
        VITE_HYBRID_SEARCH_RRF_WEIGHT: '0.5',
        VITE_HYBRID_SEARCH_LEXICAL_WEIGHT: '0.3',
        VITE_HYBRID_SEARCH_SEMANTIC_WEIGHT: '0.2',
        VITE_HYBRID_SEARCH_CONFIDENCE_WEIGHT: '0.27',
        VITE_HYBRID_SEARCH_SEMANTIC_DISTANCE_CUTOFF: '0.83',
        VITE_HYBRID_SEARCH_SEMANTIC_CANDIDATE_MULTIPLIER: '4',
        VITE_HYBRID_SEARCH_FEED_CANDIDATE_MULTIPLIER: '5',
      }),
    ).toEqual({
      queryTimeoutMs: 2_500,
      timeoutRetryDelayMs: 40,
      rrfWeight: 0.5,
      lexicalWeight: 0.3,
      semanticWeight: 0.2,
      confidenceWeight: 0.27,
      semanticDistanceCutoff: 0.83,
      semanticCandidateMultiplier: 4,
      feedSemanticCandidateMultiplier: 5,
      queryEmbedCacheTtlMs: 60_000,
      queryEmbedCacheMax: 128,
    });

    expect(
      resolveHybridSearchRuntimeConfig({
        VITE_HYBRID_SEARCH_QUERY_TIMEOUT_MS: '-9',
        VITE_HYBRID_SEARCH_TIMEOUT_RETRY_DELAY_MS: 'oops',
        VITE_HYBRID_SEARCH_RRF_WEIGHT: '0',
        VITE_HYBRID_SEARCH_LEXICAL_WEIGHT: '0',
        VITE_HYBRID_SEARCH_SEMANTIC_WEIGHT: '0',
        VITE_HYBRID_SEARCH_CONFIDENCE_WEIGHT: '-1',
        VITE_HYBRID_SEARCH_SEMANTIC_DISTANCE_CUTOFF: '-2',
        VITE_HYBRID_SEARCH_SEMANTIC_CANDIDATE_MULTIPLIER: '0',
        VITE_HYBRID_SEARCH_FEED_CANDIDATE_MULTIPLIER: '-3',
      }),
    ).toEqual({
      queryTimeoutMs: 0,
      timeoutRetryDelayMs: 120,
      rrfWeight: 0.45,
      lexicalWeight: 0.3,
      semanticWeight: 0.25,
      confidenceWeight: 0,
      semanticDistanceCutoff: null,
      semanticCandidateMultiplier: 1,
      feedSemanticCandidateMultiplier: 1,
      queryEmbedCacheTtlMs: 60_000,
      queryEmbedCacheMax: 128,
    });
  });
});
