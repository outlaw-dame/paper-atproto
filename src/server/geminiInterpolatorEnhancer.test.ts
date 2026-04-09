import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key',
  GEMINI_INTERPOLATOR_ENHANCER_ENABLED: true,
  GEMINI_INTERPOLATOR_ENHANCER_MODEL: 'gemini-3-flash-preview',
  GEMINI_INTERPOLATOR_ENHANCER_FALLBACK_MODELS: 'gemini-2.5-flash',
  LLM_TIMEOUT_MS: 250,
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/lib/googleGenAi.js', () => ({
  createGoogleGenAIClient: () => ({
    models: {
      generateContent: mockGenerateContent,
    },
  }),
  resolveGeminiModel: (_lane: string, override?: string | null) => override ?? 'gemini-3-flash-preview',
  resolveGeminiModelFallbackChain: (_lane: string, override?: string | null) => [override ?? 'gemini-3-flash-preview', 'gemini-2.5-flash'],
  isGemini3Model: (model?: string | null) => String(model ?? '').startsWith('gemini-3'),
  geminiThinkingConfig: () => ({ thinkingConfig: { thinkingLevel: 'minimal' } }),
  isGeminiModelFallbackEligibleError: (error: unknown) => {
    const status = (error as { status?: number })?.status;
    return typeof status === 'number' && [400, 401, 403, 404, 408, 425, 429, 500, 502, 503, 504].includes(status);
  },
  withGeminiModelFallback: async <T,>(
    models: string[],
    runner: (model: string) => Promise<T>,
    shouldFallback: (error: unknown, context: { model: string; attempt: number; nextModel: string | null; attemptedModels: string[] }) => boolean,
  ) => {
    const attemptedModels: string[] = [];
    for (let attempt = 0; attempt < models.length; attempt += 1) {
      const model = models[attempt]!;
      attemptedModels.push(model);
      try {
        return { model, value: await runner(model) };
      } catch (error) {
        const nextModel = models[attempt + 1] ?? null;
        if (!nextModel || !shouldFallback(error, { model, attempt, nextModel, attemptedModels: [...attemptedModels] })) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            geminiAttemptedModels: [...attemptedModels],
            geminiFallbackExhausted: nextModel === null,
          });
        }
      }
    }
    throw new Error('Gemini model fallback chain exhausted');
  },
}));

import { reviewWithGeminiInterpolatorEnhancer } from '../../server/src/services/geminiInterpolatorEnhancer.js';

describe('geminiInterpolatorEnhancer', () => {
  beforeEach(() => {
    envMock.GEMINI_INTERPOLATOR_ENHANCER_ENABLED = true;
    mockGenerateContent.mockReset();
  });

  it('sends the canonical writer contract and candidate output to Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        decision: 'accept',
        issues: [],
      }),
    });

    const result = await reviewWithGeminiInterpolatorEnhancer({
      request: {
        threadId: 'thread-1',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.54,
          entityConfidence: 0.67,
          interpretiveConfidence: 0.42,
        },
        visibleReplyCount: 4,
        rootPost: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          handle: 'author.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: new Date().toISOString(),
        },
        selectedComments: [
          {
            uri: 'at://did:plc:reply/app.bsky.feed.post/1',
            handle: 'reply.one',
            text: 'Feels closer to earlier incidents than fresh reporting.',
            impactScore: 0.72,
            role: 'counterpoint',
          },
        ],
        topContributors: [
          {
            handle: 'reply.one',
            role: 'counterpoint',
            impactScore: 0.72,
            stanceSummary: 'compares the claim to earlier incidents',
            stanceExcerpt: 'Feels closer to earlier incidents than fresh reporting.',
            resonance: 'moderate',
            agreementSignal: 'other replies echo the same comparison',
          },
        ],
        safeEntities: [
          { id: '1', label: '@author.test', type: 'person', confidence: 0.99, impact: 0.92 },
          { id: '2', label: 'OpenBSD', type: 'software', confidence: 0.87, impact: 0.84 },
        ],
        factualHighlights: ['The post names OpenBSD, ffmpeg, Linux, and FreeBSD.'],
        whatChangedSignals: ['counterpoint: replies compare it to earlier incidents'],
        mediaFindings: [
          {
            mediaType: 'screenshot',
            summary: 'A screenshot of the post text only.',
            confidence: 0.81,
            extractedText: 'New Claude found zero-days...',
          },
        ],
        threadSignalSummary: {
          newAnglesCount: 0,
          clarificationsCount: 0,
          sourceBackedCount: 0,
          factualSignalPresent: true,
          evidencePresent: false,
        },
        interpretiveExplanation: 'Low-confidence interpretive thread with repetitive replies.',
        entityThemes: ['security disclosure claim'],
      },
      candidate: {
        collapsedSummary: 'Visible replies mostly compare it to earlier incidents.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
    });

    expect(result).toEqual({
      model: 'gemini-3-flash-preview',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    const request = mockGenerateContent.mock.calls[0]?.[0] as {
      model?: string;
      contents?: string;
      config?: {
        responseMimeType?: string;
        httpOptions?: { timeout?: number; retryOptions?: { attempts?: number } };
        thinkingConfig?: { thinkingLevel?: string };
      };
    };

    expect(request.model).toBe('gemini-3-flash-preview');
    expect(request.config?.responseMimeType).toBe('application/json');
    expect(request.config?.httpOptions?.timeout).toBe(12000);
    expect(request.config?.httpOptions?.retryOptions?.attempts).toBe(3);
    expect(request.config?.thinkingConfig?.thinkingLevel).toBe('minimal');
    expect(request.contents).toContain('You are the Glympse Interpolator QA and takeover layer.');
    expect(request.contents).toContain('AUDIT CHECKLIST');
    expect(request.contents).toContain('CANONICAL IMPLEMENTATION PATHS');
    expect(request.contents).toContain('server/src/services/qwenWriter.ts');
    expect(request.contents).toContain('src/conversation/sessionAssembler.ts');
    expect(request.contents).toContain('src/intelligence/modelClient.ts');
    expect(request.contents).toContain('STRUCTURED THREAD BRIEF');
    expect(request.contents).toContain('ROOT POST — @author.test');
    expect(request.contents).toContain('VISIBLE REPLIES: 4');
    expect(request.contents).toContain('CONTRIBUTOR DETAILS:');
    expect(request.contents).toContain('SAFE ENTITIES:');
    expect(request.contents).toContain('MEDIA FINDINGS:');
    expect(request.contents).toContain('THREAD SIGNAL SUMMARY:');
    expect(request.contents).toContain('INTERPRETIVE EXPLANATION: Low-confidence interpretive thread with repetitive replies.');
    expect(request.contents).toContain('CANDIDATE_RESPONSE_JSON:');
    expect(request.contents).toContain('Visible replies mostly compare it to earlier incidents.');
  });

  it('sends Qwen failure context when there is no usable candidate', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        decision: 'replace',
        issues: ['base-writer-failed'],
        response: {
          collapsedSummary: '@author.test claims Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies add little beyond comparing it to earlier incidents.',
          whatChanged: ['counterpoint: replies compare it to earlier incidents'],
          contributorBlurbs: [],
          abstained: false,
          mode: 'descriptive_fallback',
        },
      }),
    });

    const result = await reviewWithGeminiInterpolatorEnhancer({
      request: {
        threadId: 'thread-2',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.5,
          entityConfidence: 0.6,
          interpretiveConfidence: 0.35,
        },
        visibleReplyCount: 4,
        rootPost: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          handle: 'author.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: new Date().toISOString(),
        },
        selectedComments: [],
        topContributors: [],
        safeEntities: [],
        factualHighlights: [],
        whatChangedSignals: [],
      },
      qwenFailure: 'Writer returned invalid JSON',
    });

    expect(result).toEqual({
      model: 'gemini-3-flash-preview',
      decision: {
        decision: 'replace',
        issues: ['base-writer-failed'],
        response: {
          collapsedSummary: '@author.test claims Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies add little beyond comparing it to earlier incidents.',
          whatChanged: ['counterpoint: replies compare it to earlier incidents'],
          contributorBlurbs: [],
          abstained: false,
          mode: 'descriptive_fallback',
        },
      },
    });

    const request = mockGenerateContent.mock.calls[0]?.[0] as { contents?: string };
    expect(request.contents).toContain('QWEN_STATUS: failed');
    expect(request.contents).toContain('QWEN_FAILURE: Writer returned invalid JSON');
  });

  it('repairs lightly malformed JSON responses before validating the decision', async () => {
    const malformed = JSON.stringify(
      '{"decision":"replace","issues":["generic-reply-pattern"],"response":{"collapsedSummary":"@author.test says Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies mostly compare the claim to earlier incidents.","whatChanged":["counterpoint: replies compare it to earlier incidents"],"contributorBlurbs":[],"abstained":false,"mode":"descriptive_fallback",}}',
    );
    mockGenerateContent.mockResolvedValueOnce({
      text: malformed,
    });

    const result = await reviewWithGeminiInterpolatorEnhancer({
      request: {
        threadId: 'thread-3',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.5,
          entityConfidence: 0.6,
          interpretiveConfidence: 0.35,
        },
        visibleReplyCount: 4,
        rootPost: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          handle: 'author.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: new Date().toISOString(),
        },
        selectedComments: [],
        topContributors: [],
        safeEntities: [],
        factualHighlights: [],
        whatChangedSignals: [],
      },
      candidate: {
        collapsedSummary: 'Visible replies mostly compare it to earlier incidents.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
    });

    expect(result).toEqual({
      model: 'gemini-3-flash-preview',
      decision: {
        decision: 'replace',
        issues: ['generic-reply-pattern'],
        response: {
          collapsedSummary: '@author.test says Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies mostly compare the claim to earlier incidents.',
          whatChanged: ['counterpoint: replies compare it to earlier incidents'],
          contributorBlurbs: [],
          abstained: false,
          mode: 'descriptive_fallback',
        },
      },
    });
  });

  it('retries once when Gemini returns truncated JSON', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: '{ "decision": "replace", "issues":',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          decision: 'accept',
          issues: [],
        }),
      });

    const result = await reviewWithGeminiInterpolatorEnhancer({
      request: {
        threadId: 'thread-4',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.5,
          entityConfidence: 0.6,
          interpretiveConfidence: 0.35,
        },
        visibleReplyCount: 4,
        rootPost: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          handle: 'author.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: new Date().toISOString(),
        },
        selectedComments: [],
        topContributors: [],
        safeEntities: [],
        factualHighlights: [],
        whatChangedSignals: [],
      },
      candidate: {
        collapsedSummary: 'Visible replies mostly compare it to earlier incidents.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
    });

    expect(result).toEqual({
      model: 'gemini-3-flash-preview',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('falls back to Gemini 2.5 before failing the enhancer', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(Object.assign(new Error('model unavailable'), { status: 404, code: 'model_not_found' }))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          decision: 'accept',
          issues: [],
        }),
      });

    const result = await reviewWithGeminiInterpolatorEnhancer({
      request: {
        threadId: 'thread-5',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.5,
          entityConfidence: 0.6,
          interpretiveConfidence: 0.35,
        },
        visibleReplyCount: 4,
        rootPost: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          handle: 'author.test',
          text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
          createdAt: new Date().toISOString(),
        },
        selectedComments: [],
        topContributors: [],
        safeEntities: [],
        factualHighlights: [],
        whatChangedSignals: [],
      },
      candidate: {
        collapsedSummary: 'Visible replies mostly compare it to earlier incidents.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
    });

    expect(result).toEqual({
      model: 'gemini-2.5-flash',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(mockGenerateContent.mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-3-flash-preview' });
    expect(mockGenerateContent.mock.calls[1]?.[0]).toMatchObject({ model: 'gemini-2.5-flash' });
  });
});
