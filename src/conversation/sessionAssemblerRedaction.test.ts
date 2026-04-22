import { describe, expect, it } from 'vitest';
import {
  redactPremiumInterpolatorInputByUserRules,
  redactWriterResultByUserRules,
} from './sessionAssembler';
import type { InterpolatorWriteResult } from '../intelligence/llmContracts';
import type { PremiumInterpolatorRequest } from '../intelligence/premiumContracts';
import type { KeywordFilterRule } from '../lib/contentFilters/types';

function makeRule(overrides: Partial<KeywordFilterRule>): KeywordFilterRule {
  return {
    id: 'rule-1',
    phrase: 'term',
    wholeWord: false,
    contexts: ['thread'],
    action: 'warn',
    enabled: true,
    expiresAt: null,
    semantic: false,
    semanticThreshold: 0.72,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWriterResult(): InterpolatorWriteResult {
  return {
    collapsedSummary: 'This summary mentions spicy term in context.',
    expandedSummary: 'Expanded section includes #term and more detail.',
    whatChanged: ['new angle: term appears repeatedly'],
    contributorBlurbs: [{ handle: 'alpha', blurb: 'alpha references term directly' }],
    abstained: false,
    mode: 'normal',
  };
}

function makePremiumInput(): PremiumInterpolatorRequest {
  return {
    actorDid: 'did:plc:abc',
    threadId: 'at://did:plc:root/app.bsky.feed.post/root',
    summaryMode: 'normal',
    confidence: {
      surfaceConfidence: 0.72,
      entityConfidence: 0.66,
      interpretiveConfidence: 0.61,
    },
    rootPost: {
      uri: 'at://did:plc:root/app.bsky.feed.post/root',
      handle: 'author.test',
      text: 'Root post includes term in the opening claim.',
      createdAt: new Date().toISOString(),
    },
    selectedComments: [
      {
        uri: 'at://did:plc:reply/app.bsky.feed.post/1',
        handle: 'reply.one',
        text: 'Reply mentions term in a source-backed way.',
        impactScore: 0.8,
      },
    ],
    topContributors: [
      {
        handle: 'reply.one',
        role: 'source-bringer',
        impactScore: 0.8,
        stanceSummary: 'main point: term appears in the memo',
        stanceExcerpt: 'term appears in the memo',
        agreementSignal: 'other replies agreed with the term framing',
      },
    ],
    safeEntities: [
      {
        id: 'entity-1',
        label: 'Term Policy',
        type: 'topic',
        confidence: 0.9,
        impact: 0.8,
      },
    ],
    factualHighlights: ['term appears in the archived memo'],
    whatChangedSignals: ['source cited: term in memo'],
    mediaFindings: [
      {
        mediaType: 'document',
        summary: 'Screenshot repeats the term in a policy header.',
        confidence: 0.82,
        extractedText: 'term header',
      },
    ],
    interpretiveExplanation: 'term is central but some context is still missing',
    entityThemes: ['term policy revision'],
    interpretiveBrief: {
      summaryMode: 'normal',
      baseSummary: 'Base summary contains term.',
      supports: ['term is repeated in multiple replies'],
      limits: ['term context is incomplete'],
    },
  };
}

describe('session assembler writer redaction', () => {
  it('redacts matched phrases without suppressing output', () => {
    const input = makeWriterResult();
    const rules = [makeRule({ phrase: 'term', wholeWord: false })];

    const redacted = redactWriterResultByUserRules(input, rules);

    expect(redacted.abstained).toBe(false);
    expect(redacted.collapsedSummary).toContain('[filtered]');
    expect(redacted.expandedSummary ?? '').toContain('[filtered]');
    expect(redacted.whatChanged[0] ?? '').toContain('[filtered]');
    expect(redacted.contributorBlurbs[0]?.blurb ?? '').toContain('[filtered]');
  });

  it('supports hashtag variants for the same rule phrase', () => {
    const input = makeWriterResult();
    input.expandedSummary = 'Expanded section includes #term and #Term.';

    const rules = [makeRule({ phrase: 'term', wholeWord: false })];
    const redacted = redactWriterResultByUserRules(input, rules);

    expect(redacted.expandedSummary ?? '').not.toMatch(/#term|#Term/);
    expect(redacted.expandedSummary ?? '').toContain('[filtered]');
  });

  it('respects whole-word rules and avoids partial-word redaction', () => {
    const input = makeWriterResult();
    input.collapsedSummary = 'determine and terms should remain when only term is whole-word filtered.';

    const rules = [makeRule({ phrase: 'term', wholeWord: true })];
    const redacted = redactWriterResultByUserRules(input, rules);

    expect(redacted.collapsedSummary).toContain('determine');
    expect(redacted.collapsedSummary).toContain('terms');
    expect(redacted.collapsedSummary).toContain('[filtered]');
  });

  it('redacts premium Gemini inputs across contributor, entity, and media fields', () => {
    const input = makePremiumInput();
    const rules = [makeRule({ phrase: 'term', wholeWord: false })];

    const redacted = redactPremiumInterpolatorInputByUserRules(input, rules);

    expect(redacted.rootPost.text).toContain('[filtered]');
    expect(redacted.topContributors[0]?.stanceSummary ?? '').toContain('[filtered]');
    expect(redacted.topContributors[0]?.stanceExcerpt ?? '').toContain('[filtered]');
    expect(redacted.safeEntities[0]?.label ?? '').toContain('[filtered]');
    expect(redacted.mediaFindings?.[0]?.summary ?? '').toContain('[filtered]');
    expect(redacted.mediaFindings?.[0]?.extractedText ?? '').toContain('[filtered]');
    expect(redacted.interpretiveExplanation ?? '').toContain('[filtered]');
    expect(redacted.entityThemes?.[0] ?? '').toContain('[filtered]');
    expect(redacted.interpretiveBrief.baseSummary ?? '').toContain('[filtered]');
  });
});
