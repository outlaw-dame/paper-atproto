import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EdgeExecutionPlan } from './edgeProviderContracts';
import {
  EdgeCapabilityMismatchError,
  EdgeEndpointRequestError,
  EdgeProviderMismatchError,
  UnsupportedEdgeProviderError,
  UnsupportedEdgeCapabilityError,
  runEdgeExecution,
} from './edgeProviderRuntime';
import {
  getEdgeRuntimeTelemetrySnapshot,
  resetEdgeRuntimeTelemetry,
} from './edgeProviderRuntimeTelemetry';

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
    resetEdgeRuntimeTelemetry();
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

    const snapshot = getEdgeRuntimeTelemetrySnapshot();
    expect(snapshot.attemptedByCapability.composer_classify).toBe(1);
    expect(snapshot.succeededByCapability.composer_classify).toBe(1);
    expect(snapshot.failedByCapability.composer_classify).toBe(0);
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

  it('keeps search rerank explicitly unsupported until endpoint routing lands', async () => {
    await expect(runEdgeExecution({
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
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);
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

    const snapshot = getEdgeRuntimeTelemetrySnapshot();
    expect(snapshot.attemptedByCapability.media_classify).toBe(1);
    expect(snapshot.succeededByCapability.media_classify).toBe(1);
    expect(snapshot.failureReasons.endpoint_http_error).toBe(0);
  });

  it('rejects non-JSON media responses with explicit error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not json</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    await expect(runEdgeExecution({
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
    })).rejects.toThrow('Expected JSON response');

    const snapshot = getEdgeRuntimeTelemetrySnapshot();
    expect(snapshot.failedByCapability.media_classify).toBe(1);
    expect(snapshot.failureReasons.endpoint_non_json).toBe(1);
  });

  it('records endpoint HTTP failures for media dispatch', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream down', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }));

    await expect(runEdgeExecution({
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
    })).rejects.toBeInstanceOf(EdgeEndpointRequestError);

    const snapshot = getEdgeRuntimeTelemetrySnapshot();
    expect(snapshot.failedByCapability.media_classify).toBe(1);
    expect(snapshot.failureReasons.endpoint_http_error).toBe(1);
  });

  it('keeps search unsupported even when provider is non-cloudflare', async () => {
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
    })).rejects.toBeInstanceOf(UnsupportedEdgeCapabilityError);

    const snapshot = getEdgeRuntimeTelemetrySnapshot();
    expect(snapshot.attemptedByCapability.search_rerank).toBe(1);
    expect(snapshot.failedByCapability.search_rerank).toBe(1);
    expect(snapshot.failureReasons.capability_unsupported).toBe(1);
  });

  it('fails fast for media when planned provider is unsupported', async () => {
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
