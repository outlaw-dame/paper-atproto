import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParse = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  OPENAI_API_KEY: 'test-key',
  OPENAI_DEEP_INTERPOLATOR_MODEL: 'gpt-5.4',
  PREMIUM_AI_TIMEOUT_MS: 250,
  PREMIUM_AI_RETRY_ATTEMPTS: 2,
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

import { OpenAIConversationProvider } from '../../server/src/ai/providers/openAiConversation.provider.js';

function buildRequest() {
  return {
    actorDid: 'did:plc:abc',
    threadId: 'thread-1',
    summaryMode: 'descriptive_fallback' as const,
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
        resonance: 'high' as const,
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
      summaryMode: 'descriptive_fallback' as const,
      baseSummary: 'Base summary.',
      dominantTone: 'contested',
      conversationPhase: 'active',
      supports: ['source-backed clarification'],
      limits: ['limited participant breadth'],
    },
  };
}

describe('OpenAIConversationProvider', () => {
  beforeEach(() => {
    mockParse.mockReset();
  });

  it('uses structured outputs with privacy-safe request options', async () => {
    mockParse.mockResolvedValueOnce({
      output_parsed: {
        summary: 'OpenAI deep summary.',
        groundedContext: 'Grounded context.',
        perspectiveGaps: ['Missing stakeholder reaction'],
        followUpQuestions: ['What changed after the memo leaked?'],
        confidence: 0.74,
      },
      output_text: '',
    });

    const provider = new OpenAIConversationProvider();
    (provider as unknown as { client: { responses: { parse: typeof mockParse } } | null }).client = {
      responses: {
        parse: mockParse,
      },
    };

    const result = await provider.writeDeepInterpolator(buildRequest());

    expect(result.summary).toBe('OpenAI deep summary.');
    expect(result.provider).toBe('openai');
    expect(mockParse).toHaveBeenCalledTimes(1);
    const request = mockParse.mock.calls[0]?.[0] as {
      instructions?: string;
      input?: string;
      max_output_tokens?: number;
      store?: boolean;
      text?: {
        verbosity?: string;
        format?: {
          type?: string;
          name?: string;
        };
      };
    };
    expect(request.instructions).toContain('You are the Glympse Deep Interpolator.');
    expect(request.instructions).toContain('Use the root author as the anchor when that makes the summary clearer.');
    expect(request.instructions).toContain('When the root post makes a concrete claim, prefer naming the root author in the summary\'s first sentence.');
    expect(request.instructions).toContain('Name up to two strongest contributors by handle when they materially add sourcing, clarification, or correction.');
    expect(request.input).toContain('CONTRIBUTOR DETAILS:');
    expect(request.input).toContain('PRIORITY PARTICIPANTS TO NAME WHEN MATERIAL:');
    expect(request.input).toContain('MEDIA FINDINGS:');
    expect(request.input).toContain('THREAD SIGNAL SUMMARY:');
    expect(request.text?.format?.type).toBe('json_schema');
    expect(request.text?.format?.name).toBe('glympse_deep_interpolator');
    expect(request.text?.verbosity).toBe('low');
    expect(request.max_output_tokens).toBe(700);
    expect(request.store).toBe(false);
  });

  it('falls back to validated JSON output when parsed content is unavailable', async () => {
    mockParse.mockResolvedValueOnce({
      output_parsed: null,
      output_text: JSON.stringify({
        summary: 'Fallback summary.',
        groundedContext: 'Fallback context.',
        perspectiveGaps: ['Missing direct confirmation'],
        followUpQuestions: ['Did anyone post the primary source?'],
        confidence: 0.68,
      }),
    });

    const provider = new OpenAIConversationProvider();
    (provider as unknown as { client: { responses: { parse: typeof mockParse } } | null }).client = {
      responses: {
        parse: mockParse,
      },
    };

    const result = await provider.writeDeepInterpolator(buildRequest());

    expect(result.summary).toBe('Fallback summary.');
    expect(result.groundedContext).toBe('Fallback context.');
    expect(result.confidence).toBe(0.68);
  });

  it('fails closed when the structured response is invalid', async () => {
    mockParse.mockResolvedValueOnce({
      output_parsed: null,
      output_text: 'not valid json',
    });

    const provider = new OpenAIConversationProvider();
    (provider as unknown as { client: { responses: { parse: typeof mockParse } } | null }).client = {
      responses: {
        parse: mockParse,
      },
    };

    await expect(provider.writeDeepInterpolator(buildRequest())).rejects.toMatchObject({
      status: 502,
      message: 'OpenAI premium AI returned invalid structured output',
    });
  });

  it('does not retry quota exhaustion errors', async () => {
    const quotaError = Object.assign(new Error('quota exceeded'), {
      status: 429,
      code: 'insufficient_quota',
    });
    mockParse.mockRejectedValueOnce(quotaError);

    const provider = new OpenAIConversationProvider();
    (provider as unknown as { client: { responses: { parse: typeof mockParse } } | null }).client = {
      responses: {
        parse: mockParse,
      },
    };

    await expect(provider.writeDeepInterpolator(buildRequest())).rejects.toBe(quotaError);
    expect(mockParse).toHaveBeenCalledTimes(1);
  });
});
