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

import { writePremiumDeepInterpolator } from '../../server/src/ai/providerRouter.js';

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
  beforeEach(() => {
    mockResolveEffectivePremiumAiProvider.mockReset();
    mockOpenAIWrite.mockReset();
    mockGeminiWrite.mockReset();
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

  it('does not mask non-provider-outage failures behind a fallback', async () => {
    const timeoutError = Object.assign(new Error('Premium AI timed out'), { status: 504 });
    mockResolveEffectivePremiumAiProvider.mockReturnValueOnce('openai');
    mockOpenAIWrite.mockRejectedValueOnce(timeoutError);

    await expect(
      writePremiumDeepInterpolator(request, { preferredProvider: 'openai' }),
    ).rejects.toBe(timeoutError);

    expect(mockGeminiWrite).not.toHaveBeenCalled();
  });
});
