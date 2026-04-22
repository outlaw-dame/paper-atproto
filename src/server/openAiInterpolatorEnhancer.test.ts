import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParse = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  OPENAI_API_KEY: 'test-key',
  OPENAI_INTERPOLATOR_ENHANCER_MODEL: 'gpt-5.4',
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/lib/openAi.js', () => ({
  createOpenAIClient: () => ({
    responses: {
      parse: mockParse,
    },
  }),
  resolveOpenAiModel: () => 'gpt-5.4',
}));

import { reviewWithOpenAiInterpolatorEnhancer } from '../../server/src/services/openAiInterpolatorEnhancer.js';

describe('openAiInterpolatorEnhancer', () => {
  beforeEach(() => {
    mockParse.mockReset();
  });

  it('uses structured outputs to review the canonical writer contract', async () => {
    mockParse.mockResolvedValueOnce({
      output_parsed: {
        decision: 'accept',
        issues: [],
      },
      output_text: '',
    });

    const result = await reviewWithOpenAiInterpolatorEnhancer({
      request: {
        threadId: 'thread-openai-enhancer',
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
      model: 'gpt-5.4',
      decision: {
        decision: 'accept',
        issues: [],
      },
    });

    const request = mockParse.mock.calls[0]?.[0] as {
      instructions?: string;
      input?: string;
      store?: boolean;
      text?: { format?: { type?: string; name?: string } };
    };
    expect(request.instructions).toContain('You are the Glympse Interpolator QA and takeover layer.');
    expect(request.input).toContain('CANDIDATE_RESPONSE_JSON:');
    expect(request.input).toContain('Visible replies mostly compare it to earlier incidents.');
    expect(request.store).toBe(false);
    expect(request.text?.format?.type).toBe('json_schema');
    expect(request.text?.format?.name).toBe('glympse_interpolator_enhancer_review');
  });

  it('fails closed when structured enhancer output is invalid', async () => {
    mockParse.mockResolvedValueOnce({
      output_parsed: null,
      output_text: '{"decision":"replace"',
    });

    await expect(reviewWithOpenAiInterpolatorEnhancer({
      request: {
        threadId: 'thread-openai-enhancer-failure',
        summaryMode: 'descriptive_fallback',
        confidence: {
          surfaceConfidence: 0.54,
          entityConfidence: 0.67,
          interpretiveConfidence: 0.42,
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
      },
      candidate: {
        collapsedSummary: 'Weak candidate.',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: false,
        mode: 'descriptive_fallback',
      },
    })).rejects.toMatchObject({
      status: 502,
      message: 'OpenAI interpolator enhancer returned invalid structured output',
    });
  });
});
