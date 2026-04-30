import { describe, expect, it } from 'vitest';

import {
  chooseIntelligenceLane,
  evaluateLocalSearchQuality,
  isBrowserExperimentalAllowed,
  shouldEscalateLocalSearchToEdge,
} from './intelligenceRoutingPolicy';

describe('intelligenceRoutingPolicy', () => {
  it('keeps instant composer guidance in the browser heuristic lane', () => {
    expect(chooseIntelligenceLane({ task: 'composer_instant' })).toMatchObject({
      lane: 'browser_heuristic',
      reasonCode: 'browser_heuristic_instant',
      sendsPrivateText: false,
    });
  });

  it('routes balanced composer refinement to edge classifier by default', () => {
    expect(chooseIntelligenceLane({
      task: 'composer_refine',
      privacyMode: 'balanced',
      edgeAvailable: true,
    })).toMatchObject({
      lane: 'edge_classifier',
      fallbackLane: 'browser_heuristic',
      sendsPrivateText: true,
      requiresConsent: true,
      reasonCode: 'edge_classifier_balanced_refine',
    });
  });

  it('keeps composer refinement local when privacy mode is local only', () => {
    expect(chooseIntelligenceLane({
      task: 'composer_refine',
      privacyMode: 'local_only',
      edgeAvailable: true,
    })).toMatchObject({
      lane: 'browser_heuristic',
      sendsPrivateText: false,
      reasonCode: 'local_only_privacy',
    });
  });

  it('allows browser experimental only with explicit opt-in and enough device headroom', () => {
    expect(isBrowserExperimentalAllowed({
      browserExperimentalEnabled: true,
      deviceTier: 'high',
      deviceMemoryGiB: 16,
      isMobile: false,
    })).toBe(true);

    expect(isBrowserExperimentalAllowed({
      browserExperimentalEnabled: true,
      deviceTier: 'high',
      deviceMemoryGiB: 16,
      isMobile: true,
    })).toBe(false);

    expect(isBrowserExperimentalAllowed({
      browserExperimentalEnabled: false,
      deviceTier: 'high',
      deviceMemoryGiB: 16,
      isMobile: false,
    })).toBe(false);
  });

  it('uses browser small ML as the private local search lane', () => {
    expect(chooseIntelligenceLane({
      task: 'local_search',
      dataScope: 'private_corpus',
      privacyMode: 'balanced',
      localSmallMlAvailable: true,
      edgeAvailable: true,
    })).toMatchObject({
      lane: 'browser_small_ml',
      reasonCode: 'browser_small_ml_private_search',
      sendsPrivateText: false,
    });
  });

  it('escalates public search to edge reranker when local confidence is low', () => {
    const lowQuality = evaluateLocalSearchQuality({
      resultLimit: 10,
      rows: [
        { confidence_score: 0.28, fts_rank_raw: 0, semantic_matched: 1, semantic_distance: 0.9 },
        { confidence_score: 0.22, fts_rank_raw: 0, semantic_matched: 1, semantic_distance: 0.95 },
      ],
      localIndexCoverage: 0.35,
    });

    expect(lowQuality.confidence).toBeLessThan(0.48);
    expect(chooseIntelligenceLane({
      task: 'public_search',
      dataScope: 'public_corpus',
      privacyMode: 'balanced',
      localSmallMlAvailable: true,
      edgeAvailable: true,
      localSearchQuality: lowQuality,
    })).toMatchObject({
      lane: 'edge_reranker',
      fallbackLane: 'browser_small_ml',
      reasonCode: 'edge_reranker_public_scope',
      sendsPrivateText: false,
    });
  });

  it('keeps high-confidence local search on browser small ML with edge fallback', () => {
    const highQuality = evaluateLocalSearchQuality({
      resultLimit: 5,
      rows: [
        { confidence_score: 0.94, fts_rank_raw: 0.9, semantic_matched: 1, semantic_distance: 0.15 },
        { confidence_score: 0.62, fts_rank_raw: 0.7, semantic_matched: 1, semantic_distance: 0.25 },
        { confidence_score: 0.5, fts_rank_raw: 0.4, semantic_matched: 1, semantic_distance: 0.35 },
        { confidence_score: 0.4, fts_rank_raw: 0.3, semantic_matched: 1, semantic_distance: 0.45 },
      ],
      localIndexCoverage: 0.9,
    });

    expect(highQuality.confidence).toBeGreaterThanOrEqual(0.72);
    expect(chooseIntelligenceLane({
      task: 'local_search',
      dataScope: 'local_cache',
      privacyMode: 'balanced',
      localSmallMlAvailable: true,
      edgeAvailable: true,
      localSearchQuality: highQuality,
    })).toMatchObject({
      lane: 'browser_small_ml',
      fallbackLane: 'edge_reranker',
      reasonCode: 'browser_small_ml_high_quality_local',
    });
  });

  it('does not escalate private local search to edge even when local confidence is poor', () => {
    const quality = evaluateLocalSearchQuality({
      resultLimit: 10,
      rows: [{ confidence_score: 0.1, fts_rank_raw: 0, semantic_matched: 1, semantic_distance: 1 }],
      localIndexCoverage: 0.2,
    });

    expect(shouldEscalateLocalSearchToEdge(quality, {
      privacyMode: 'balanced',
      dataScope: 'private_corpus',
      edgeAvailable: true,
    })).toBe(false);
  });
});
