import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    OLLAMA_BASE_URL: 'http://localhost:11434',
    LLM_LOCAL_ONLY: true,
    QWEN_WRITER_MODEL: 'qwen-test',
    LLM_TIMEOUT_MS: 5_000,
  },
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

describe('qwenWriter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('extracts JSON payloads wrapped in fences and sanitizes prompt text', async () => {
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
    const userPrompt = body.messages[1]?.content ?? '';

    expect(userPrompt).toContain('ROOT POST — @badhandle');
    expect(userPrompt).not.toContain('\u0000');
    expect(userPrompt).not.toContain('<script>');
    expect(userPrompt).toContain('A reply comment');
    expect(userPrompt).toContain('point: pointed to prior tournament examples that matched this pattern');
    expect(userPrompt).toContain('agreement: drew visible agreement from other participants');
    expect(userPrompt).toContain('resonance:moderate');
  });
});
