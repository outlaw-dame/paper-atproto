import { describe, expect, it } from 'vitest';

import type { MediaAnalysisRequest, MediaAnalysisResult } from '../llmContracts';
import {
  buildCaptionFallbackMediaAnalysis,
  refineMediaAnalysisResult,
} from './mediaAnalysisRefinement';

function makeRequest(overrides: Partial<MediaAnalysisRequest> = {}): MediaAnalysisRequest {
  return {
    threadId: 'thread-1',
    mediaUrl: 'https://safe.example/policy.png',
    mediaAlt: 'policy screenshot',
    nearbyText: 'This screenshot shows the agency policy memo that people are debating.',
    candidateEntities: ['Agency'],
    factualHints: ['People want the underlying memo.'],
    ...overrides,
  };
}

function makeResult(overrides: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    mediaCentrality: 0.18,
    mediaType: 'photo',
    mediaSummary: 'A photo.',
    candidateEntities: [],
    confidence: 0.42,
    cautionFlags: [],
    ...overrides,
  };
}

describe('media analysis refinement', () => {
  it('upgrades weak photo outputs when surrounding thread context clearly indicates a screenshot', () => {
    const result = refineMediaAnalysisResult(
      makeRequest(),
      makeResult({
        extractedText: 'WEEKEND SERVICE REDUCTION BEGINS MAY 1',
      }),
    );

    expect(result.mediaType).toBe('screenshot');
    expect(result.mediaCentrality).toBeGreaterThan(0.45);
    expect(result.mediaSummary.toLowerCase()).toContain('screenshot');
    expect(result.extractedText).toContain('WEEKEND SERVICE REDUCTION');
  });

  it('builds a usable caption-only fallback for media-aware thread context', () => {
    const result = buildCaptionFallbackMediaAnalysis(
      makeRequest(),
      'A screenshot of a redlined transit policy memo from the agency.',
    );

    expect(result.mediaType).toBe('screenshot');
    expect(result.mediaSummary.toLowerCase()).toContain('redlined transit policy memo');
    expect(result.candidateEntities).toContain('Agency');
    expect(result.confidence).toBeGreaterThan(0.35);
  });
});
