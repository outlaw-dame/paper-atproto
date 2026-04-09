import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  envMock,
  mockResolvePremiumAiEntitlements,
  mockEnsurePremiumAiProviderReady,
  mockWritePremiumDeepInterpolator,
  mockFilterPremiumDeepInterpolatorResponse,
  mockLogSafetyFlag,
} = vi.hoisted(() => ({
  envMock: {
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://app.glympse.example',
    CORS_ALLOW_PRIVATE_NETWORK_IN_DEV: true,
  },
  mockResolvePremiumAiEntitlements: vi.fn(),
  mockEnsurePremiumAiProviderReady: vi.fn(),
  mockWritePremiumDeepInterpolator: vi.fn(),
  mockFilterPremiumDeepInterpolatorResponse: vi.fn((value: unknown) => ({
    filtered: value,
    safetyMetadata: {
      passed: true,
      flagged: false,
      severity: 'none',
      categories: [],
    },
  })),
  mockLogSafetyFlag: vi.fn(),
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/entitlements/resolveAiEntitlements.js', () => ({
  resolvePremiumAiEntitlements: mockResolvePremiumAiEntitlements,
}));

vi.mock('../../server/src/ai/premiumProviderReadiness.js', () => ({
  ensurePremiumAiProviderReady: mockEnsurePremiumAiProviderReady,
}));

vi.mock('../../server/src/ai/providerRouter.js', () => ({
  writePremiumDeepInterpolator: mockWritePremiumDeepInterpolator,
}));

vi.mock('../../server/src/services/safetyFilters.js', () => ({
  filterPremiumDeepInterpolatorResponse: mockFilterPremiumDeepInterpolatorResponse,
  logSafetyFlag: mockLogSafetyFlag,
}));

import { premiumAiRouter } from '../../server/src/routes/premiumAi.js';

const TRUSTED_ORIGIN = 'https://app.glympse.example';
const ACTOR_DID = 'did:plc:abcdefghijklmnop';

function makeRequestBody() {
  return {
    actorDid: ACTOR_DID,
    threadId: 'at://did:plc:thread/app.bsky.feed.post/1',
    summaryMode: 'normal',
    confidence: {
      surfaceConfidence: 0.8,
      entityConfidence: 0.7,
      interpretiveConfidence: 0.75,
    },
    rootPost: {
      uri: 'at://did:plc:root/app.bsky.feed.post/1',
      handle: 'alice.test',
      text: 'Root post',
      createdAt: new Date().toISOString(),
    },
    selectedComments: [],
    topContributors: [],
    safeEntities: [],
    factualHighlights: [],
    whatChangedSignals: [],
    interpretiveBrief: {
      summaryMode: 'normal',
      supports: [],
      limits: [],
    },
  };
}

describe('premiumAiRouter trust boundaries', () => {
  beforeEach(() => {
    envMock.NODE_ENV = 'production';
    envMock.CORS_ALLOWED_ORIGINS = TRUSTED_ORIGIN;
    envMock.CORS_ALLOW_PRIVATE_NETWORK_IN_DEV = true;
    mockResolvePremiumAiEntitlements.mockReset();
    mockEnsurePremiumAiProviderReady.mockReset();
    mockWritePremiumDeepInterpolator.mockReset();
    mockFilterPremiumDeepInterpolatorResponse.mockClear();
    mockLogSafetyFlag.mockClear();
    mockEnsurePremiumAiProviderReady.mockResolvedValue(undefined);
    mockResolvePremiumAiEntitlements.mockReturnValue({
      tier: 'pro',
      capabilities: ['deep_interpolator'],
      providerAvailable: true,
      availableProviders: ['gemini', 'openai'],
      provider: 'gemini',
    });
    mockWritePremiumDeepInterpolator.mockResolvedValue({
      summary: 'Trusted summary',
      groundedContext: 'Grounded context',
      perspectiveGaps: [],
      followUpQuestions: [],
      confidence: 0.82,
      provider: 'gemini',
      updatedAt: new Date().toISOString(),
    });
  });

  it('rejects premium entitlements lookups from disallowed origins when a DID header is supplied', async () => {
    const response = await premiumAiRouter.request('/entitlements', {
      method: 'GET',
      headers: {
        Origin: 'https://evil.example',
        'X-Glympse-User-Did': ACTOR_DID,
      },
    });

    expect(response.status).toBe(403);
    const payload = await response.json() as { error?: string; code?: string };
    expect(payload.code).toBe('FORBIDDEN');
    expect(payload.error).toContain('not allowed from this origin');
    expect(mockResolvePremiumAiEntitlements).not.toHaveBeenCalled();
  });

  it('requires a validated DID header for premium deep interpolation', async () => {
    const response = await premiumAiRouter.request('/interpolator/deep', {
      method: 'POST',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(makeRequestBody()),
    });

    expect(response.status).toBe(401);
    const payload = await response.json() as { error?: string; code?: string };
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.error).toContain('Missing X-Glympse-User-Did header');
    expect(mockWritePremiumDeepInterpolator).not.toHaveBeenCalled();
  });

  it('accepts trusted premium deep interpolation requests only when header and body actor match', async () => {
    const response = await premiumAiRouter.request('/interpolator/deep', {
      method: 'POST',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'content-type': 'application/json',
        'X-Glympse-User-Did': ACTOR_DID,
      },
      body: JSON.stringify(makeRequestBody()),
    });

    expect(response.status).toBe(200);
    expect(mockEnsurePremiumAiProviderReady).toHaveBeenCalledWith(undefined);
    expect(mockResolvePremiumAiEntitlements).toHaveBeenCalledWith(ACTOR_DID, undefined);
    expect(mockWritePremiumDeepInterpolator).toHaveBeenCalledWith(expect.objectContaining({
      actorDid: ACTOR_DID,
      threadId: 'at://did:plc:thread/app.bsky.feed.post/1',
    }), undefined);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const vary = response.headers.get('vary')?.toLowerCase() ?? '';
    expect(vary).toContain('origin');
    expect(vary).toContain('x-glympse-user-did');
    expect(vary).toContain('x-glympse-ai-provider');
  });

  it('propagates a trusted premium provider preference header to entitlements and provider routing', async () => {
    const response = await premiumAiRouter.request('/interpolator/deep', {
      method: 'POST',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'content-type': 'application/json',
        'X-Glympse-User-Did': ACTOR_DID,
        'X-Glympse-AI-Provider': 'openai',
      },
      body: JSON.stringify(makeRequestBody()),
    });

    expect(response.status).toBe(200);
    expect(mockEnsurePremiumAiProviderReady).toHaveBeenCalledWith('openai');
    expect(mockResolvePremiumAiEntitlements).toHaveBeenCalledWith(ACTOR_DID, 'openai');
    expect(mockWritePremiumDeepInterpolator).toHaveBeenCalledWith(expect.objectContaining({
      actorDid: ACTOR_DID,
    }), { preferredProvider: 'openai' });
  });

  it('returns sanitized provider outage codes and forwards retry-after headers', async () => {
    mockWritePremiumDeepInterpolator.mockRejectedValueOnce(Object.assign(
      new Error('provider temporarily unavailable'),
      {
        status: 429,
        headers: {
          'retry-after': '7',
        },
      },
    ));

    const response = await premiumAiRouter.request('/interpolator/deep', {
      method: 'POST',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'content-type': 'application/json',
        'X-Glympse-User-Did': ACTOR_DID,
      },
      body: JSON.stringify(makeRequestBody()),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    const payload = await response.json() as { error?: string; code?: string };
    expect(payload).toEqual({
      error: 'Premium AI rate-limited',
      code: 'PREMIUM_AI_RATE_LIMITED',
    });
  });
});
