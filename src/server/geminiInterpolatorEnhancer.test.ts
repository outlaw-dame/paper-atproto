import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key',
  GEMINI_INTERPOLATOR_ENHANCER_ENABLED: true,
  GEMINI_INTERPOLATOR_ENHANCER_MODEL: 'gemini-3-flash-preview',
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
  resolveGeminiModel: () => 'gemini-enhancer-test',
  isGemini3Model: () => true,
  geminiThinkingConfig: () => ({ thinkingConfig: { thinkingLevel: 'minimal' } }),
}));

import { reviewInterpolatorWriter } from '../../server/src/services/geminiInterpolatorEnhancer.js';

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

    const result = await reviewInterpolatorWriter({
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
      decision: 'accept',
      issues: [],
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

    expect(request.model).toBe('gemini-enhancer-test');
    expect(request.config?.responseMimeType).toBe('application/json');
    expect(request.config?.httpOptions?.timeout).toBe(12000);
    expect(request.config?.httpOptions?.retryOptions?.attempts).toBe(3);
    expect(request.config?.thinkingConfig?.thinkingLevel).toBe('minimal');
    expect(request.contents).toContain('You are the Gemini Interpolator QA and takeover layer for Glympse.');
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

    const result = await reviewInterpolatorWriter({
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
      decision: 'replace',
      issues: ['base-writer-failed'],
      response: {
        collapsedSummary: '@author.test claims Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies add little beyond comparing it to earlier incidents.',
        whatChanged: ['counterpoint: replies compare it to earlier incidents'],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
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

    const result = await reviewInterpolatorWriter({
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
      decision: 'replace',
      issues: ['generic-reply-pattern'],
      response: {
        collapsedSummary: '@author.test says Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies mostly compare the claim to earlier incidents.',
        whatChanged: ['counterpoint: replies compare it to earlier incidents'],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
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

    const result = await reviewInterpolatorWriter({
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
      decision: 'accept',
      issues: [],
    });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});
