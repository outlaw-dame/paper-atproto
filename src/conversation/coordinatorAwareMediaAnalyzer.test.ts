import { describe, expect, it, vi } from 'vitest';

import { createCoordinatorAwareMediaAnalyzer, shouldUseCoordinatorEdgeMediaPlan } from './coordinatorAwareMediaAnalyzer';
import { buildSessionBrief } from '../intelligence/coordinator/sessionBrief';
import { __adviseInternalForTesting } from '../intelligence/coordinator/intelligenceCoordinator';
import type { MediaAnalysisRequest, MediaAnalysisResult } from '../intelligence/llmContracts';

const REQUEST: MediaAnalysisRequest = {
  threadId: 'at://did:plc:test/app.bsky.feed.post/root',
  mediaUrl: 'https://example.com/image.png',
  nearbyText: 'A screenshot of a product launch timeline with revised dates.',
  mediaAlt: 'Timeline screenshot',
  candidateEntities: ['Launch timeline', 'Product update'],
  factualHints: ['dates were revised'],
};

function createResult(summary: string): MediaAnalysisResult {
  return {
    mediaCentrality: 0.8,
    mediaType: 'screenshot',
    mediaSummary: summary,
    candidateEntities: ['Launch timeline'],
    confidence: 0.82,
    cautionFlags: [],
    analysisStatus: 'complete',
    moderationStatus: 'unavailable',
  };
}

describe('coordinatorAwareMediaAnalyzer', () => {
  it('prefers the coordinator edge plan for media analysis advice', async () => {
    const advice = await __adviseInternalForTesting(buildSessionBrief({
      surface: 'media',
      intent: 'media_analysis',
      attachments: { hasImages: true, hasLinks: false, hasCode: false },
    }));

    expect(shouldUseCoordinatorEdgeMediaPlan(advice)).toBe(true);
    expect(advice.edgePlan?.provider).toBe('cloudflare-workers-ai');
    expect(advice.edgePlan?.endpoint).toBe('/api/edge/media-classify');

    const fallbackAnalyzeMedia = vi.fn().mockResolvedValue(createResult('fallback'));
    const edgeExecutor = vi.fn().mockResolvedValue({
      capability: 'media_classify',
      provider: 'cloudflare-workers-ai',
      output: createResult('edge'),
    });

    const analyzeMedia = createCoordinatorAwareMediaAnalyzer({
      advice,
      fallbackAnalyzeMedia,
      edgeExecutor,
    });

    const result = await analyzeMedia(REQUEST);

    expect(result.mediaSummary).toBe('edge');
    expect(edgeExecutor).toHaveBeenCalledTimes(1);
    expect(fallbackAnalyzeMedia).not.toHaveBeenCalled();
  });

  it('falls back to the server analyzer when the edge request fails', async () => {
    const advice = await __adviseInternalForTesting(buildSessionBrief({
      surface: 'media',
      intent: 'media_analysis',
      attachments: { hasImages: true, hasLinks: false, hasCode: false },
    }));

    const fallbackAnalyzeMedia = vi.fn().mockResolvedValue(createResult('fallback'));
    const edgeExecutor = vi.fn().mockRejectedValue(new Error('network down'));
    const onEdgeFallback = vi.fn();

    const analyzeMedia = createCoordinatorAwareMediaAnalyzer({
      advice,
      fallbackAnalyzeMedia,
      edgeExecutor,
      onEdgeFallback,
    });

    const result = await analyzeMedia(REQUEST);

    expect(result.mediaSummary).toBe('fallback');
    expect(edgeExecutor).toHaveBeenCalledTimes(1);
    expect(fallbackAnalyzeMedia).toHaveBeenCalledTimes(1);
    expect(onEdgeFallback).toHaveBeenCalledTimes(1);
  });

  it('routes overflow requests to premium analyzer when available', async () => {
    const advice = await __adviseInternalForTesting(buildSessionBrief({
      surface: 'media',
      intent: 'media_analysis',
      attachments: { hasImages: true, hasLinks: false, hasCode: false },
    }));

    const fallbackAnalyzeMedia = vi.fn().mockResolvedValue(createResult('fallback'));
    const premiumAnalyzeMedia = vi.fn().mockResolvedValue(createResult('premium'));
    const edgeExecutor = vi.fn().mockResolvedValue({
      capability: 'media_classify',
      provider: 'cloudflare-workers-ai',
      output: createResult('edge'),
    });

    const analyzeMedia = createCoordinatorAwareMediaAnalyzer({
      advice,
      fallbackAnalyzeMedia,
      premiumAnalyzeMedia,
      edgeExecutor,
    });

    const result = await analyzeMedia({ ...REQUEST, overflow: true });

    expect(result.mediaSummary).toBe('premium');
    expect(premiumAnalyzeMedia).toHaveBeenCalledTimes(1);
    expect(edgeExecutor).not.toHaveBeenCalled();
    expect(fallbackAnalyzeMedia).not.toHaveBeenCalled();
  });
});