import { describe, expect, it, vi } from 'vitest';

import type { EdgeExecutionPlan } from './edgeProviderContracts';
import {
  EdgeCapabilityMismatchError,
  UnsupportedEdgeCapabilityError,
  runEdgeExecution,
} from './edgeProviderRuntime';

vi.mock('../composer/edgeClassifierClient', () => ({
  callComposerEdgeClassifier: vi.fn(async () => ({
    provider: 'cloudflare-workers-ai',
    model: '@cf/huggingface/distilbert-sst-2-int8',
    confidence: 0.81,
    toolsUsed: ['edge-classifier', 'sentiment-polarity'],
    ml: {},
    abuseScore: null,
  })),
}));

function plan(capability: EdgeExecutionPlan['capability']): EdgeExecutionPlan {
  return {
    capability,
    provider: 'cloudflare-workers-ai',
    endpoint: '/api/test',
    lane: 'edge_classifier',
    task: 'composer_refine',
    privacyMode: 'balanced',
    sendsPrivateText: true,
    requiresConsent: false,
    maxPayloadChars: 1200,
    reasonCode: 'test',
  };
}

describe('runEdgeExecution', () => {
  it('dispatches composer classifier via existing runtime path', async () => {
    const result = await runEdgeExecution(plan('composer_classify'), {
      capability: 'composer_classify',
      input: {
        mode: 'post',
        draftText: 'This draft should be classified on the edge.',
      },
    });

    expect(result.capability).toBe('composer_classify');
    expect(result.provider).toBe('cloudflare-workers-ai');
    if (result.capability !== 'composer_classify') {
      throw new Error('Expected composer_classify response');
    }
    expect(result.output.model).toBe('@cf/huggingface/distilbert-sst-2-int8');
  });

  it('fails fast when request capability does not match planner capability', async () => {
    await expect(runEdgeExecution(plan('composer_classify'), {
      capability: 'media_classify',
      input: { media: [] },
    })).rejects.toBeInstanceOf(EdgeCapabilityMismatchError);
  });

  it('marks non-composer capabilities as explicitly unsupported for this slice', async () => {
    await expect(runEdgeExecution(plan('search_rerank'), {
      capability: 'search_rerank',
      input: { query: 'demo' },
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);

    await expect(runEdgeExecution(plan('media_classify'), {
      capability: 'media_classify',
      input: { media: [] },
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);

    await expect(runEdgeExecution(plan('story_summarize'), {
      capability: 'story_summarize',
      input: { story: 'demo' },
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);
  });
});
