import { describe, expect, it } from 'vitest';

import {
  parseDeepInterpolatorOutputJson,
  truncateNarrativeText,
  validateDeepInterpolatorResult,
} from '../../server/src/ai/providers/deepInterpolatorShared.js';

describe('deepInterpolatorShared', () => {
  function buildRequest() {
    return {
      actorDid: 'did:plc:test',
      threadId: 'thread-1',
      summaryMode: 'descriptive_fallback' as const,
      confidence: {
        surfaceConfidence: 0.58,
        entityConfidence: 0.63,
        interpretiveConfidence: 0.44,
      },
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
          impactScore: 0.8,
          role: 'source_bringer',
        },
      ],
      topContributors: [
        {
          handle: 'reply.one',
          role: 'source-bringer',
          impactScore: 0.81,
          stanceSummary: 'linked the memo',
        },
      ],
      safeEntities: [],
      factualHighlights: ['Memo text names the affected office.'],
      whatChangedSignals: ['source cited: memo text'],
      mediaFindings: [
        {
          mediaType: 'document',
          summary: 'Screenshot of the memo header.',
          confidence: 0.88,
          analysisStatus: 'degraded' as const,
          moderationStatus: 'unavailable' as const,
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
        baseSummary: 'People are debating whether the leaked memo confirms a Friday closure.',
        supports: ['source-backed clarification'],
        limits: ['limited participant breadth'],
      },
    };
  }

  it('prefers a complete sentence when trimming long narrative text', () => {
    const longSummary = [
      '@memo.author says Friday will be a full City Hall closure after the gas inspection, but the posted notice supports a narrower reading focused on inspection-related access changes rather than a confirmed shutdown.',
      '@source.one adds the memo header and building notice, while @clarify.two points out that no official city statement in the visible thread confirms a full closure.',
      'Additional replies start branching into practical consequences for classes and library operations without resolving the core uncertainty yet.',
    ].join(' ');

    const result = validateDeepInterpolatorResult({
      summary: longSummary,
      groundedContext: null,
      perspectiveGaps: [],
      followUpQuestions: [],
      confidence: 0.81,
    }, 'openai', buildRequest());

    expect(result.summary.length).toBeLessThanOrEqual(420);
    expect(result.summary.endsWith('.')).toBe(true);
    expect(result.summary.includes('without resolving the core uncertainty yet')).toBe(false);
    expect(result.summary.includes('...')).toBe(false);
  });

  it('falls back to a word boundary when no sentence boundary is available', () => {
    const repeatedClause = 'alpha beta gamma delta epsilon zeta eta theta iota kappa ';
    const truncated = truncateNarrativeText(repeatedClause.repeat(20), 120);

    expect(truncated.length).toBeLessThanOrEqual(123);
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('rejects non-additive premium summaries when the request contains richer thread signals', () => {
    const request = buildRequest();

    expect(() => validateDeepInterpolatorResult({
      summary: 'People are debating whether the leaked memo confirms a Friday closure.',
      groundedContext: null,
      perspectiveGaps: ['More context is needed'],
      followUpQuestions: ['What changed?'],
      confidence: 0.66,
    }, 'openai', request)).toThrow(/non-additive summary/i);
  });

  it('filters generic gaps and duplicate grounded context from premium output', () => {
    const request = buildRequest();

    const result = validateDeepInterpolatorResult({
      summary: '@author.test says the leaked memo points to a Friday closure, while @reply.one adds the posted memo header and keeps the closure claim contested.',
      groundedContext: '@author.test says the leaked memo points to a Friday closure, while @reply.one adds the posted memo header and keeps the closure claim contested.',
      perspectiveGaps: ['More context is needed', 'No visible response from the city agency itself'],
      followUpQuestions: ['What changed?', 'Did the agency post the full memo?'],
      confidence: 0.71,
    }, 'openai', request);

    expect(result.groundedContext).toBeUndefined();
    expect(result.perspectiveGaps).toEqual(['No visible response from the city agency itself']);
    expect(result.followUpQuestions).toEqual(['Did the agency post the full memo?']);
  });

  it('repairs nested stringified JSON for premium output parsing', () => {
    const parsed = parseDeepInterpolatorOutputJson(JSON.stringify(JSON.stringify({
      summary: 'Nested summary.',
      groundedContext: 'Nested context.',
      perspectiveGaps: ['Missing primary source'],
      followUpQuestions: ['Did anyone post the original advisory?'],
      confidence: 0.64,
    })));

    expect(parsed.summary).toBe('Nested summary.');
    expect(parsed.groundedContext).toBe('Nested context.');
    expect(parsed.perspectiveGaps).toEqual(['Missing primary source']);
  });

  it('marks truncated JSON as retryable structured-output failure', () => {
    try {
      parseDeepInterpolatorOutputJson('{"summary":"partial"');
      throw new Error('Expected parseDeepInterpolatorOutputJson to throw');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Premium AI returned invalid structured output',
        code: 'DEEP_INTERPOLATOR_INVALID_STRUCTURED_OUTPUT',
        retryable: true,
      });
    }
  });
});
