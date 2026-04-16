import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key',
  GEMINI_DEEP_INTERPOLATOR_MODEL: 'gemini-3-flash-preview',
  GEMINI_DEEP_INTERPOLATOR_FALLBACK_MODELS: 'gemini-2.5-flash',
  PREMIUM_AI_TIMEOUT_MS: 250,
  PREMIUM_AI_RETRY_ATTEMPTS: 2,
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

import { GeminiConversationProvider } from '../../server/src/ai/providers/geminiConversation.provider.js';
import { getPremiumDiagnostics, resetPremiumDiagnostics } from '../../server/src/llm/premiumDiagnostics.js';

describe('GeminiConversationProvider', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    resetPremiumDiagnostics();
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
      config?: {
        maxOutputTokens?: number;
        responseJsonSchema?: unknown;
        thinkingConfig?: { thinkingLevel?: string };
        httpOptions?: { timeout?: number; retryOptions?: { attempts?: number } };
      };
    };
    expect(request.contents).toContain('When the root post makes a concrete claim, prefer naming the root author in the summary\'s first sentence.');
    expect(request.contents).toContain('CONTRIBUTOR DETAILS:');
    expect(request.contents).toContain('PRIORITY PARTICIPANTS TO NAME WHEN MATERIAL:');
    expect(request.contents).toContain('@author.test (root author)');
    expect(request.contents).toContain('point:linked the memo');
    expect(request.contents).toContain('MEDIA FINDINGS:');
    expect(request.contents).toContain('THREAD SIGNAL SUMMARY:');
    expect(request.contents).toContain('ENTITY THEMES:');
    expect(request.contents).toContain('INTERPRETIVE EXPLANATION:');
    expect(request.contents).toContain('ENTITY CONFIDENCE: 0.61');
    expect(request.config?.maxOutputTokens).toBe(700);
    expect(request.config?.responseJsonSchema).toBeTruthy();
    expect(request.config?.thinkingConfig?.thinkingLevel).toBe('MINIMAL');
    expect(request.config?.httpOptions?.retryOptions?.attempts).toBe(3);
    expect(request.config?.httpOptions?.timeout).toBe(12_000);
  });

  it('extracts structured JSON from Gemini candidate parts when response.text is unusable', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '{"summary":"partial"',
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: 'Gemini parts summary.',
                  groundedContext: 'Parts grounded context.',
                  perspectiveGaps: ['No primary source'],
                  followUpQuestions: ['Did anyone post the official notice?'],
                  confidence: 0.69,
                }),
              },
            ],
          },
        },
      ],
    });

    const provider = new GeminiConversationProvider();
    (provider as unknown as { client: { models: { generateContent: typeof mockGenerateContent } } | null }).client = {
      models: {
        generateContent: mockGenerateContent,
      },
    };

    const result = await provider.writeDeepInterpolator({
      actorDid: 'did:plc:abc',
      threadId: 'thread-parts',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.52,
        entityConfidence: 0.61,
        interpretiveConfidence: 0.47,
      },
      rootPost: {
        uri: 'at://did:plc:root/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Root post text.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'descriptive_fallback',
        supports: [],
        limits: [],
      },
    });

    expect(result.summary).toBe('Gemini parts summary.');
    expect(result.groundedContext).toBe('Parts grounded context.');
  });

  it('retries the same Gemini model when structured output looks truncated', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: '{"summary":"partial"',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'Recovered summary.',
          groundedContext: 'Recovered context.',
          perspectiveGaps: [],
          followUpQuestions: [],
          confidence: 0.66,
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
      threadId: 'thread-retry',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.52,
        entityConfidence: 0.61,
        interpretiveConfidence: 0.47,
      },
      rootPost: {
        uri: 'at://did:plc:root/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Root post text.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'descriptive_fallback',
        supports: [],
        limits: [],
      },
    });

    expect(result.summary).toBe('Recovered summary.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-3-flash-preview' });
    expect(mockGenerateContent.mock.calls[1]?.[0]).toMatchObject({ model: 'gemini-3-flash-preview' });
  });

  it('surfaces structured-output exhaustion honestly when both Gemini models fail JSON repair', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: '{"summary":"partial"',
      })
      .mockResolvedValueOnce({
        text: '{"summary":"partial"',
      })
      .mockResolvedValueOnce({
        text: '{"summary":"partial"',
      })
      .mockResolvedValueOnce({
        text: '{"summary":"partial"',
      });

    const provider = new GeminiConversationProvider();
    (provider as unknown as { client: { models: { generateContent: typeof mockGenerateContent } } | null }).client = {
      models: {
        generateContent: mockGenerateContent,
      },
    };

    await expect(provider.writeDeepInterpolator({
      actorDid: 'did:plc:abc',
      threadId: 'thread-1',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.52,
        entityConfidence: 0.61,
        interpretiveConfidence: 0.47,
      },
      rootPost: {
        uri: 'at://did:plc:root/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Root post text.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'descriptive_fallback',
        supports: [],
        limits: [],
      },
    })).rejects.toMatchObject({
      status: 502,
      code: 'DEEP_INTERPOLATOR_INVALID_STRUCTURED_OUTPUT',
    });
  });

  it('falls back to Gemini 2.5 before failing the deep interpolator', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(Object.assign(new Error('model unavailable'), { status: 404, code: 'model_not_found' }))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'Gemini fallback summary.',
          groundedContext: 'Fallback grounded context.',
          perspectiveGaps: [],
          followUpQuestions: [],
          confidence: 0.68,
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
      threadId: 'thread-fallback',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.52,
        entityConfidence: 0.61,
        interpretiveConfidence: 0.47,
      },
      rootPost: {
        uri: 'at://did:plc:root/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'Root post text.',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
      interpretiveBrief: {
        summaryMode: 'descriptive_fallback',
        supports: [],
        limits: [],
      },
    });

    expect(result.summary).toBe('Gemini fallback summary.');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini-3-flash-preview',
      config: { maxOutputTokens: 700 },
    });
    expect(mockGenerateContent.mock.calls[1]?.[0]).toMatchObject({
      model: 'gemini-2.5-flash',
      config: { maxOutputTokens: 4000 },
    });
    const diagnostics = getPremiumDiagnostics() as {
      providers?: Record<string, {
        lastModel?: string | null;
        models?: Record<string, { attempts?: number; successes?: number; failures?: number }>;
      }>;
    };
    expect(diagnostics.providers?.gemini?.lastModel).toBe('gemini-2.5-flash');
    expect(diagnostics.providers?.gemini?.models?.['gemini-3-flash-preview']?.attempts).toBe(1);
    expect(diagnostics.providers?.gemini?.models?.['gemini-3-flash-preview']?.failures).toBe(1);
    expect(diagnostics.providers?.gemini?.models?.['gemini-2.5-flash']?.attempts).toBe(1);
    expect(diagnostics.providers?.gemini?.models?.['gemini-2.5-flash']?.successes).toBe(1);
  });
});
