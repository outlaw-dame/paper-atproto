import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EdgeExecutionPlan } from './edgeProviderContracts';
import {
  EdgeCapabilityMismatchError,
  EdgeProviderMismatchError,
  UnsupportedEdgeProviderError,
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

const fetchMock = vi.fn();

describe('runEdgeExecution', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      input: {
        threadId: 'at://example/thread',
        mediaUrl: 'https://example.com/image.jpg',
        nearbyText: 'demo',
        candidateEntities: [],
        factualHints: [],
      },
    })).rejects.toBeInstanceOf(EdgeCapabilityMismatchError);
  });

  it('fails when classifier returns a provider not allowed by the plan', async () => {
    await expect(runEdgeExecution({
      ...plan('composer_classify'),
      provider: 'node-heuristic',
    }, {
      capability: 'composer_classify',
      input: {
        mode: 'post',
        draftText: 'Provider mismatch should fail fast.',
      },
    })).rejects.toBeInstanceOf(EdgeProviderMismatchError);
  });

  it('dispatches search rerank via planned edge endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ id: 'p:1', score: 0.92 }],
      model: 'cloudflare-reranker-v1',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await runEdgeExecution({
      ...plan('search_rerank'),
      endpoint: '/api/llm/rerank/search',
      lane: 'edge_reranker',
      task: 'public_search',
    }, {
      capability: 'search_rerank',
      input: {
        query: 'best postgame analysis',
        candidates: [{ id: 'p:1', text: 'candidate text' }],
      },
    });

    expect(result.capability).toBe('search_rerank');
    expect(result.provider).toBe('cloudflare-workers-ai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dispatches media classification via planned edge endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      mediaCentrality: 0.7,
      mediaType: 'photo',
      mediaSummary: 'A player celebrating after a goal.',
      candidateEntities: ['player'],
      confidence: 0.84,
      cautionFlags: [],
      analysisStatus: 'complete',
      moderationStatus: 'authoritative',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await runEdgeExecution({
      ...plan('media_classify'),
      endpoint: '/api/llm/analyze/media',
      task: 'media_analysis',
    }, {
      capability: 'media_classify',
      input: {
        threadId: 'at://example/thread',
        mediaUrl: 'https://example.com/image.jpg',
        nearbyText: 'celebration image',
        candidateEntities: ['player'],
        factualHints: [],
      },
    });

    expect(result.capability).toBe('media_classify');
    expect(result.provider).toBe('cloudflare-workers-ai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast when search/media are planned with unsupported providers', async () => {
    await expect(runEdgeExecution({
      ...plan('search_rerank'),
      provider: 'node-heuristic',
      lane: 'edge_reranker',
      task: 'public_search',
    }, {
      capability: 'search_rerank',
      input: {
        query: 'demo',
        candidates: [{ id: '1', text: 'x' }],
      },
    })).rejects.toBeInstanceOf(UnsupportedEdgeProviderError);

    await expect(runEdgeExecution({
      ...plan('media_classify'),
      provider: 'node-heuristic',
      task: 'media_analysis',
    }, {
      capability: 'media_classify',
      input: {
        threadId: 'at://example/thread',
        mediaUrl: 'https://example.com/image.jpg',
        nearbyText: 'demo',
        candidateEntities: [],
        factualHints: [],
      },
    })).rejects.toBeInstanceOf(UnsupportedEdgeProviderError);
  });

  it('keeps story summarize unsupported in this slice', async () => {
    await expect(runEdgeExecution(plan('story_summarize'), {
      capability: 'story_summarize',
      input: { story: 'demo' },
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);
  });
});
