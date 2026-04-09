import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock, reviewInterpolatorWriterMock } = vi.hoisted(() => ({
  envMock: {
    OLLAMA_BASE_URL: 'http://localhost:11434',
    LLM_LOCAL_ONLY: true,
    QWEN_WRITER_MODEL: 'qwen-test',
    LLM_TIMEOUT_MS: 5_000,
    GEMINI_INTERPOLATOR_ENHANCER_MODEL: 'gemini-3-flash-preview',
    OPENAI_INTERPOLATOR_ENHANCER_MODEL: 'gpt-5.4',
  },
  reviewInterpolatorWriterMock: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

vi.mock('./interpolatorEnhancer.js', () => ({
  reviewInterpolatorWriter: reviewInterpolatorWriterMock,
  resolveInterpolatorEnhancerModel: vi.fn(() => 'gemini-3-flash-preview'),
}));

describe('qwenWriter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    reviewInterpolatorWriterMock.mockReset();
  });

  it('extracts JSON payloads wrapped in fences and sanitizes prompt text', async () => {
    const { getWriterDiagnostics, resetWriterDiagnostics } = await import('../llm/writerDiagnostics.js');
    resetWriterDiagnostics();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        message: {
          role: 'assistant',
          content: '```json\n{"collapsedSummary":"Thread summary.","whatChanged":[],"contributorBlurbs":[],"abstained":false,"mode":"normal"}\n```',
        },
        done: true,
      })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { runInterpolatorWriter } = await import('./qwenWriter.js');

    const result = await runInterpolatorWriter({
      threadId: 'thread-1',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.8,
        entityConfidence: 0.8,
        interpretiveConfidence: 0.8,
      },
      rootPost: {
        uri: 'at://post/1',
        handle: 'Bad Handle <script>',
        text: 'Hello\u0000 world\nwith control chars',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://reply/1',
          handle: 'Reply User',
          text: 'A\u0007 reply comment',
          impactScore: 0.6,
        },
      ],
      topContributors: [
        {
          handle: 'Top User',
          role: 'source_bringer',
          impactScore: 0.7,
          stanceSummary: 'added context',
          stanceExcerpt: 'pointed to prior tournament examples that matched this pattern',
          resonance: 'moderate',
          agreementSignal: 'drew visible agreement from other participants',
        },
      ],
      safeEntities: [
        {
          id: 'e1',
          label: 'Entity\u0000 Name',
          type: 'person',
          confidence: 0.9,
          impact: 0.8,
        },
      ],
      factualHighlights: ['line\u0000 one'],
      whatChangedSignals: ['clarification:\u0000 details'],
    });

    expect(result.collapsedSummary).toBe('Thread summary.');

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = body.messages[0]?.content ?? '';
    const userPrompt = body.messages[1]?.content ?? '';

    expect(systemPrompt).toContain('Name the root author');
    expect(systemPrompt).toContain('mention them by handle');
    expect(userPrompt).toContain('ROOT POST — @badhandle');
    expect(userPrompt).not.toContain('\u0000');
    expect(userPrompt).not.toContain('<script>');
    expect(userPrompt).toContain('A reply comment');
    expect(userPrompt).toContain('point: pointed to prior tournament examples that matched this pattern');
    expect(userPrompt).toContain('agreement: drew visible agreement from other participants');
    expect(userPrompt).toContain('resonance:moderate');
    expect(reviewInterpolatorWriterMock).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({
        collapsedSummary: 'Thread summary.',
      }),
    }), undefined);

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        invocations?: number;
        reviews?: number;
        decisionCounts?: { accept?: number };
        appliedTakeovers?: { total?: number };
      };
    };
    expect(diagnostics.enhancer?.invocations).toBe(1);
    expect(diagnostics.enhancer?.reviews).toBe(0);
    expect(diagnostics.enhancer?.decisionCounts?.accept).toBe(0);
    expect(diagnostics.enhancer?.appliedTakeovers?.total).toBe(0);
  });

  it('lets the remote enhancer replace a weak but valid Qwen result', async () => {
    const { getWriterDiagnostics, resetWriterDiagnostics } = await import('../llm/writerDiagnostics.js');
    resetWriterDiagnostics();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        message: {
          role: 'assistant',
          content: '{"collapsedSummary":"Visible replies mostly compare it to earlier incidents.","whatChanged":[],"contributorBlurbs":[],"abstained":false,"mode":"descriptive_fallback"}',
        },
        done: true,
      })),
    });
    vi.stubGlobal('fetch', fetchMock);
    reviewInterpolatorWriterMock.mockResolvedValueOnce({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      decision: {
        decision: 'replace',
        issues: ['generic-reply-pattern'],
        response: {
          collapsedSummary: '@author.test says Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies mostly compare the claim to earlier incidents.',
          whatChanged: ['clarification: replies frame it as another security-model moment'],
          contributorBlurbs: [
            {
              handle: 'reply.one',
              blurb: 'compares the post to earlier security-model incidents rather than adding new reporting.',
            },
          ],
          abstained: false,
          mode: 'descriptive_fallback',
        },
      },
    });

    const { runInterpolatorWriter } = await import('./qwenWriter.js');

    const result = await runInterpolatorWriter({
      threadId: 'thread-2',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.62,
        entityConfidence: 0.74,
        interpretiveConfidence: 0.41,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://post/2',
        handle: 'author.test',
        text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
        createdAt: new Date().toISOString(),
      },
      selectedComments: [
        {
          uri: 'at://reply/2',
          handle: 'reply.one',
          text: 'This feels like earlier incidents more than new reporting.',
          impactScore: 0.56,
        },
      ],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: ['counterpoint: replies compare it to earlier incidents'],
    });

    expect(result.collapsedSummary).toBe(
      '@author.test says Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies mostly compare the claim to earlier incidents.',
    );
    expect(result.mode).toBe('descriptive_fallback');

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        invocations?: number;
        reviews?: number;
        sourceCounts?: { candidate?: number };
        decisionCounts?: { replace?: number };
        appliedTakeovers?: { candidate?: number; total?: number };
        issueDistribution?: { ['generic-reply-pattern']?: number };
        providers?: Record<string, { reviews?: number; appliedTakeovers?: { total?: number } }>;
      };
    };
    expect(diagnostics.enhancer?.invocations).toBe(1);
    expect(diagnostics.enhancer?.reviews).toBe(1);
    expect(diagnostics.enhancer?.sourceCounts?.candidate).toBe(1);
    expect(diagnostics.enhancer?.decisionCounts?.replace).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.candidate).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.total).toBe(1);
    expect(diagnostics.enhancer?.issueDistribution?.['generic-reply-pattern']).toBe(1);
    expect(diagnostics.enhancer?.providers?.gemini?.reviews).toBe(1);
    expect(diagnostics.enhancer?.providers?.gemini?.appliedTakeovers?.total).toBe(1);
  });

  it('uses remote enhancer takeover when Qwen returns invalid JSON', async () => {
    const { getWriterDiagnostics, resetWriterDiagnostics } = await import('../llm/writerDiagnostics.js');
    resetWriterDiagnostics();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        message: {
          role: 'assistant',
          content: 'not-json',
        },
        done: true,
      })),
    });
    vi.stubGlobal('fetch', fetchMock);
    reviewInterpolatorWriterMock.mockResolvedValueOnce({
      provider: 'gemini',
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

    const { runInterpolatorWriter } = await import('./qwenWriter.js');

    const result = await runInterpolatorWriter({
      threadId: 'thread-3',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.58,
        entityConfidence: 0.66,
        interpretiveConfidence: 0.36,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://post/3',
        handle: 'author.test',
        text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
    });

    expect(result.collapsedSummary).toBe(
      '@author.test claims Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD. Replies add little beyond comparing it to earlier incidents.',
    );
    expect(reviewInterpolatorWriterMock).toHaveBeenCalledWith(expect.objectContaining({
      qwenFailure: 'Writer returned invalid JSON',
    }), undefined);

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        invocations?: number;
        reviews?: number;
        sourceCounts?: { qwen_failure?: number };
        appliedTakeovers?: { rescue?: number; total?: number };
      };
    };
    expect(diagnostics.enhancer?.invocations).toBe(1);
    expect(diagnostics.enhancer?.reviews).toBe(1);
    expect(diagnostics.enhancer?.sourceCounts?.qwen_failure).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.rescue).toBe(1);
    expect(diagnostics.enhancer?.appliedTakeovers?.total).toBe(1);
  });

  it('truncates long summaries at word boundaries instead of mid-word', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            collapsedSummary: 'A claim that Claude found zero-days in OpenBSD, ffmpeg, Linux, and FreeBSD is framed as resembling past benchmark-claim cycles. Replies focus on comparing the post to earlier incidents, with no new reporting or source citation in the visible discussion. The visible thread mostly recycles prior examples instead of adding verified sourcing, technical detail, or direct evidence from the affected projects.',
            whatChanged: [],
            contributorBlurbs: [],
            abstained: false,
            mode: 'descriptive_fallback',
          }),
        },
        done: true,
      })),
    });
    vi.stubGlobal('fetch', fetchMock);
    reviewInterpolatorWriterMock.mockResolvedValueOnce(null);

    const { runInterpolatorWriter } = await import('./qwenWriter.js');

    const result = await runInterpolatorWriter({
      threadId: 'thread-4',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.5,
        entityConfidence: 0.6,
        interpretiveConfidence: 0.3,
      },
      visibleReplyCount: 4,
      rootPost: {
        uri: 'at://post/4',
        handle: 'author.test',
        text: "New Claude found zero-day's in OpenBSD, ffmpeg, Linux and FreeBSD.",
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
    });

    expect(result.collapsedSummary.length).toBeLessThanOrEqual(300);
    expect(result.collapsedSummary.endsWith('...')).toBe(true);
    expect(result.collapsedSummary.endsWith('....')).toBe(false);
    expect(result.collapsedSummary.endsWith('source ci')).toBe(false);
  });

  it('records enhancer failure classes without leaking payload text', async () => {
    const { getWriterDiagnostics, resetWriterDiagnostics } = await import('../llm/writerDiagnostics.js');
    resetWriterDiagnostics();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(async () => ({
        message: {
          role: 'assistant',
          content: '{"collapsedSummary":"Thread summary.","whatChanged":[],"contributorBlurbs":[],"abstained":false,"mode":"normal"}',
        },
        done: true,
      })),
    });
    vi.stubGlobal('fetch', fetchMock);
    reviewInterpolatorWriterMock.mockRejectedValueOnce(Object.assign(new Error('Gemini interpolator enhancer timed out while auditing root text'), {
      status: 504,
    }));

    const { runInterpolatorWriter } = await import('./qwenWriter.js');

    const result = await runInterpolatorWriter({
      threadId: 'thread-4',
      requestId: 'req-enhancer-timeout',
      summaryMode: 'normal',
      confidence: {
        surfaceConfidence: 0.7,
        entityConfidence: 0.7,
        interpretiveConfidence: 0.7,
      },
      rootPost: {
        uri: 'at://post/4',
        handle: 'author.test',
        text: 'Root text',
        createdAt: new Date().toISOString(),
      },
      selectedComments: [],
      topContributors: [],
      safeEntities: [],
      factualHighlights: [],
      whatChangedSignals: [],
    });

    expect(result.collapsedSummary).toBe('Thread summary.');

    const diagnostics = getWriterDiagnostics() as {
      enhancer?: {
        failures?: { total?: number; timeout?: number };
        lastFailure?: {
          source?: string;
          model?: string;
          status?: number;
          retryable?: boolean;
          requestId?: string;
          message?: string;
        };
        issueDistribution?: Record<string, number>;
      };
    };
    expect(diagnostics.enhancer?.failures?.total).toBe(1);
    expect(diagnostics.enhancer?.failures?.timeout).toBe(1);
    expect(diagnostics.enhancer?.lastFailure?.source).toBe('candidate');
    expect(diagnostics.enhancer?.lastFailure?.model).toBe('gemini-3-flash-preview');
    expect(diagnostics.enhancer?.lastFailure?.status).toBe(504);
    expect(diagnostics.enhancer?.lastFailure?.retryable).toBe(true);
    expect(diagnostics.enhancer?.lastFailure?.requestId).toBe('req-enhancer-timeout');
    expect(diagnostics.enhancer?.lastFailure?.message).toBe('Gemini interpolator enhancer timed out while auditing root text');
    expect(diagnostics.enhancer?.issueDistribution?.['root-text']).toBeUndefined();
  });
});
