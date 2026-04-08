import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key',
  GEMINI_DEEP_INTERPOLATOR_MODEL: 'gemini-3-flash-preview',
  PREMIUM_AI_TIMEOUT_MS: 250,
  PREMIUM_AI_RETRY_ATTEMPTS: 2,
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

import { GeminiConversationProvider } from '../../server/src/ai/providers/geminiConversation.provider.js';

describe('GeminiConversationProvider', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('sends contributor, media, and structural thread signals to Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: 'Gemini deep summary.',
        groundedContext: 'Grounded context.',
        perspectiveGaps: ['Missing stakeholder reaction'],
        followUpQuestions: ['What changed after the memo leaked?'],
        confidence: 0.74,
      }),
    });

    const provider = new GeminiConversationProvider();
    (provider as unknown as { client: { models: { generateContent: typeof mockGenerateContent } } | null }).client = {
      models: {
        generateContent: mockGenerateContent,
      },
    };

    const result = await provider.writeDeepInterpolator({
      actorDid: 'did:plc:abc',
      threadId: 'thread-1',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.52,
        entityConfidence: 0.61,
        interpretiveConfidence: 0.47,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://did:plc:root/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Root post text.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://did:plc:reply/app.bsky.feed.post/1',
          handle: 'reply.one',
          text: 'Reply text.',
          impactScore: 0.81,
          role: 'source_bringer',
        },
      ],
      topContributors: [
        {
          handle: 'reply.one',
          role: 'source-bringer',
          impactScore: 0.81,
          stanceSummary: 'main point: linked the memo',
          stanceExcerpt: 'linked the memo',
          resonance: 'high',
          agreementSignal: 'other replies echoed the memo language',
        },
      ],
      safeEntities: [
        { id: 'entity-1', label: '@author.test', type: 'person', confidence: 0.99, impact: 0.92 },
      ],
      factualHighlights: ['Memo text names the affected office.'],
      whatChangedSignals: ['source cited: memo text'],
      mediaFindings: [
        {
          mediaType: 'document',
          summary: 'Screenshot of the memo header.',
          confidence: 0.88,
          extractedText: 'Office Closure Memo',
        },
      ],
      threadSignalSummary: {
        newAnglesCount: 1,
        clarificationsCount: 1,
        sourceBackedCount: 1,
        factualSignalPresent: true,
        evidencePresent: true,
      },
      interpretiveExplanation: 'Moderate confidence with source-backed clarification.',
      entityThemes: ['Office closure memo'],
      interpretiveBrief: {
        summaryMode: 'descriptive_fallback',
        baseSummary: 'Base summary.',
        dominantTone: 'contested',
        conversationPhase: 'active',
        supports: ['source-backed clarification'],
        limits: ['limited participant breadth'],
      },
    });

    expect(result.summary).toBe('Gemini deep summary.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const request = mockGenerateContent.mock.calls[0]?.[0] as {
      contents?: string;
      config?: { thinkingConfig?: { thinkingLevel?: string } };
    };
    expect(request.contents).toContain('CONTRIBUTOR DETAILS:');
    expect(request.contents).toContain('point:linked the memo');
    expect(request.contents).toContain('MEDIA FINDINGS:');
    expect(request.contents).toContain('THREAD SIGNAL SUMMARY:');
    expect(request.contents).toContain('ENTITY THEMES:');
    expect(request.contents).toContain('INTERPRETIVE EXPLANATION:');
    expect(request.contents).toContain('ENTITY CONFIDENCE: 0.61');
    expect(request.config?.thinkingConfig?.thinkingLevel).toBe('HIGH');
  });
});
