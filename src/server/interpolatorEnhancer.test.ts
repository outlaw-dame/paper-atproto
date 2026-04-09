import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGeminiReview = vi.hoisted(() => vi.fn());
const mockOpenAiReview = vi.hoisted(() => vi.fn());
const mockRecordPremiumAiProviderFailure = vi.hoisted(() => vi.fn());
const mockRecordPremiumAiProviderSuccess = vi.hoisted(() => vi.fn());
const mockIsPremiumAiProviderOperational = vi.hoisted(
  () => vi.fn<(provider: 'gemini' | 'openai') => boolean>(() => true),
);
const mockRecordWriterEnhancerSkip = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  PREMIUM_AI_PROVIDER: 'gemini' as const,
  GEMINI_API_KEY: 'gemini-key',
  OPENAI_API_KEY: 'openai-key',
  GEMINI_INTERPOLATOR_ENHANCER_ENABLED: true,
  OPENAI_INTERPOLATOR_ENHANCER_ENABLED: true,
  GEMINI_INTERPOLATOR_ENHANCER_MODEL: 'gemini-3-flash-preview',
  OPENAI_INTERPOLATOR_ENHANCER_MODEL: 'gpt-5.4',
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/services/geminiInterpolatorEnhancer.js', () => ({
  reviewWithGeminiInterpolatorEnhancer: mockGeminiReview,
}));

vi.mock('../../server/src/services/openAiInterpolatorEnhancer.js', () => ({
  reviewWithOpenAiInterpolatorEnhancer: mockOpenAiReview,
}));

vi.mock('../../server/src/ai/premiumProviderHealth.js', () => ({
  isPremiumAiProviderOperational: mockIsPremiumAiProviderOperational,
  isPremiumAiProviderUnavailableError: (error: unknown) => {
    const status = (error as { status?: number })?.status;
    return typeof status === 'number' && [401, 403, 408, 429, 500, 502, 503, 504].includes(status);
  },
  recordPremiumAiProviderFailure: mockRecordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess: mockRecordPremiumAiProviderSuccess,
}));

vi.mock('../../server/src/llm/writerDiagnostics.js', () => ({
  recordWriterEnhancerSkip: mockRecordWriterEnhancerSkip,
}));

vi.mock('../../server/src/lib/googleGenAi.js', () => ({
  resolveGeminiModel: () => 'gemini-3-flash-preview',
}));

vi.mock('../../server/src/lib/openAi.js', () => ({
  resolveOpenAiModel: () => 'gpt-5.4',
}));

import { reviewInterpolatorWriter } from '../../server/src/services/interpolatorEnhancer.js';

const reviewInput = {
  request: {
    threadId: 'thread-1',
    summaryMode: 'descriptive_fallback' as const,
    confidence: {
      surfaceConfidence: 0.5,
      entityConfidence: 0.6,
      interpretiveConfidence: 0.4,
    },
    rootPost: {
      uri: 'at://did:plc:test/app.bsky.feed.post/root',
      handle: 'author.test',
      text: 'Root post',
      createdAt: '2026-04-08T10:00:00.000Z',
    },
    selectedComments: [],
    topContributors: [],
    safeEntities: [],
    factualHighlights: [],
    whatChangedSignals: [],
  },
  candidate: {
    collapsedSummary: 'Thread summary.',
    whatChanged: [],
    contributorBlurbs: [],
    abstained: false,
    mode: 'descriptive_fallback' as const,
  },
};

describe('interpolatorEnhancer router', () => {
  beforeEach(() => {
    mockGeminiReview.mockReset();
    mockOpenAiReview.mockReset();
    mockRecordPremiumAiProviderFailure.mockReset();
    mockRecordPremiumAiProviderSuccess.mockReset();
    mockIsPremiumAiProviderOperational.mockReset();
    mockRecordWriterEnhancerSkip.mockReset();
    mockIsPremiumAiProviderOperational.mockImplementation(() => true);
    envMock.PREMIUM_AI_PROVIDER = 'gemini';
    envMock.GEMINI_API_KEY = 'gemini-key';
    envMock.OPENAI_API_KEY = 'openai-key';
    envMock.GEMINI_INTERPOLATOR_ENHANCER_ENABLED = true;
    envMock.OPENAI_INTERPOLATOR_ENHANCER_ENABLED = true;
  });

  it('honors an explicit OpenAI preference for the local enhancer', async () => {
    mockOpenAiReview.mockResolvedValueOnce({
      model: 'gpt-5.4',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });

    const result = await reviewInterpolatorWriter(reviewInput, {
      preferredProvider: 'openai',
    });

    expect(result).toEqual({
      provider: 'openai',
      model: 'gpt-5.4',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });
    expect(mockOpenAiReview).toHaveBeenCalledTimes(1);
    expect(mockGeminiReview).not.toHaveBeenCalled();
  });

  it('falls back to OpenAI when Gemini is unavailable for the enhancer', async () => {
    mockIsPremiumAiProviderOperational.mockImplementation((provider: 'gemini' | 'openai') => {
      if (provider === 'openai') return true;
      return mockRecordPremiumAiProviderFailure.mock.calls.length === 0;
    });
    mockGeminiReview.mockRejectedValueOnce(Object.assign(new Error('permission denied'), {
      status: 403,
    }));
    mockOpenAiReview.mockResolvedValueOnce({
      model: 'gpt-5.4',
      decision: {
        decision: 'replace',
        issues: ['generic-reply-pattern'],
        response: {
          collapsedSummary: '@author.test posts a claim, and replies challenge the sourcing.',
          whatChanged: ['counterpoint: replies question sourcing'],
          contributorBlurbs: [],
          abstained: false,
          mode: 'descriptive_fallback',
        },
      },
    });

    const result = await reviewInterpolatorWriter(reviewInput);

    expect(result?.provider).toBe('openai');
    expect(mockGeminiReview).toHaveBeenCalledTimes(1);
    expect(mockOpenAiReview).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderFailure).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderSuccess).toHaveBeenCalledWith('openai');
  });

  it('returns the actual Gemini fallback model when Gemini 2.5 rescues the enhancer', async () => {
    mockGeminiReview.mockResolvedValueOnce({
      model: 'gemini-2.5-flash',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });

    const result = await reviewInterpolatorWriter(reviewInput, {
      preferredProvider: 'gemini',
    });

    expect(result).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });
  });

  it('records an unavailable skip when no operational enhancer provider remains', async () => {
    mockIsPremiumAiProviderOperational.mockImplementation(() => false);

    const result = await reviewInterpolatorWriter(reviewInput);

    expect(result).toBeNull();
    expect(mockRecordWriterEnhancerSkip).toHaveBeenCalledWith('unavailable');
  });
});
