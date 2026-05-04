import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveEffectivePremiumAiProvider = vi.hoisted(() => vi.fn());
const mockOpenAIWrite = vi.hoisted(() => vi.fn());
const mockGeminiWrite = vi.hoisted(() => vi.fn());

vi.mock('../../server/src/entitlements/resolveAiEntitlements.js', () => ({
  resolveEffectivePremiumAiProvider: mockResolveEffectivePremiumAiProvider,
}));

vi.mock('../../server/src/ai/providers/openAiConversation.provider.js', () => ({
  OpenAIConversationProvider: class {
    writeDeepInterpolator = mockOpenAIWrite;
  },
}));

vi.mock('../../server/src/ai/providers/geminiConversation.provider.js', () => ({
  GeminiConversationProvider: class {
    writeDeepInterpolator = mockGeminiWrite;
  },
}));

vi.mock('../../server/src/ai/premiumProviderHealth.js', () => ({
  isPremiumAiProviderUnavailableError: (error: unknown) => {
    const status = (error as { status?: number })?.status;
    const code = (error as { code?: string })?.code;
    return (
      status === 408
      || status === 429
      || status === 500
      || status === 502
      || status === 503
      || status === 504
      || code === 'insufficient_quota'
      || code === 'deep_interpolator_non_additive_output'
    );
  },
  recordPremiumAiProviderFailure: vi.fn(),
  recordPremiumAiProviderSuccess: vi.fn(),
}));

let writePremiumDeepInterpolator: typeof import('../../server/src/ai/providerRouter.js').writePremiumDeepInterpolator;

const request = {
  actorDid: 'did:plc:test',
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
    createdAt: '2026-04-07T22:00:00.000Z',
  },
  selectedComments: [],
  topContributors: [],
  safeEntities: [],
  factualHighlights: [],
  whatChangedSignals: [],
  interpretiveBrief: {
    summaryMode: 'descriptive_fallback' as const,
    supports: [],
    limits: [],
  },
};

describe('writePremiumDeepInterpolator', () => {
  beforeEach(async () => {
    mockResolveEffectivePremiumAiProvider.mockReset();
    mockOpenAIWrite.mockReset();
    mockGeminiWrite.mockReset();
    ({ writePremiumDeepInterpolator } = await import(`../../server/src/ai/providerRouter.js?test=${Date.now()}`));
  });

  it('falls back to a healthy provider when the preferred provider has an outage-level failure', async () => {
    mockResolveEffectivePremiumAiProvider
      .mockReturnValueOnce('openai')
      .mockReturnValueOnce('gemini');
    mockOpenAIWrite.mockRejectedValueOnce(
      Object.assign(new Error('quota exceeded'), { status: 429, code: 'insufficient_quota' }),
    );
    mockGeminiWrite.mockResolvedValueOnce({
      summary: 'Gemini fallback summary.',
      groundedContext: 'Fallback context.',
      perspectiveGaps: [],
      followUpQuestions: [],
      confidence: 0.72,
      provider: 'gemini',
      updatedAt: '2026-04-07T22:00:01.000Z',
    });

    const result = await writePremiumDeepInterpolator(request, { preferredProvider: 'openai' });

    expect(result.provider).toBe('gemini');
    expect(mockOpenAIWrite).toHaveBeenCalledTimes(1);
    expect(mockGeminiWrite).toHaveBeenCalledTimes(1);
    expect(mockResolveEffectivePremiumAiProvider).toHaveBeenNthCalledWith(1, 'openai');
    expect(mockResolveEffectivePremiumAiProvider).toHaveBeenNthCalledWith(2, 'openai');
  });

  it('falls back on transient timeout failures instead of collapsing the request', async () => {
    mockResolveEffectivePremiumAiProvider
      .mockReturnValueOnce('openai')
      .mockReturnValueOnce('gemini');
    const timeoutError = Object.assign(new Error('Premium AI timed out'), { status: 504 });
    mockOpenAIWrite.mockRejectedValueOnce(timeoutError);
    mockGeminiWrite.mockResolvedValueOnce({
      summary: 'Gemini timeout fallback summary.',
      groundedContext: 'Recovered after timeout.',
      perspectiveGaps: [],
      followUpQuestions: [],
      confidence: 0.69,
      provider: 'gemini',
      updatedAt: '2026-04-08T10:00:01.000Z',
    });

    const result = await writePremiumDeepInterpolator(request, { preferredProvider: 'openai' });

    expect(result.provider).toBe('gemini');
    expect(mockOpenAIWrite).toHaveBeenCalledTimes(1);
    expect(mockGeminiWrite).toHaveBeenCalledTimes(1);
  });

  it('does not mask non-provider-outage failures behind a fallback', async () => {
    const validationError = Object.assign(new Error('Premium AI request invalid'), { status: 422 });
    mockResolveEffectivePremiumAiProvider.mockReturnValueOnce('openai');
    mockOpenAIWrite.mockRejectedValueOnce(validationError);

    await expect(
      writePremiumDeepInterpolator(request, { preferredProvider: 'openai' }),
    ).rejects.toBe(validationError);

    expect(mockGeminiWrite).not.toHaveBeenCalled();
  });

  it('falls back when the preferred provider returns semantically invalid premium output', async () => {
    mockResolveEffectivePremiumAiProvider
      .mockReturnValueOnce('openai')
      .mockReturnValueOnce('gemini');
    mockOpenAIWrite.mockRejectedValueOnce(
      Object.assign(new Error('Deep interpolator returned a non-additive summary'), {
        status: 502,
        code: 'deep_interpolator_non_additive_output',
      }),
    );
    mockGeminiWrite.mockResolvedValueOnce({
      summary: 'Gemini rescue summary.',
      groundedContext: 'Recovered after quality validation failed.',
      perspectiveGaps: [],
      followUpQuestions: [],
      confidence: 0.7,
      provider: 'gemini',
      updatedAt: '2026-04-08T10:00:01.000Z',
    });

    const result = await writePremiumDeepInterpolator(request, { preferredProvider: 'openai' });

    expect(result.provider).toBe('gemini');
    expect(mockOpenAIWrite).toHaveBeenCalledTimes(1);
    expect(mockGeminiWrite).toHaveBeenCalledTimes(1);
  });
});
