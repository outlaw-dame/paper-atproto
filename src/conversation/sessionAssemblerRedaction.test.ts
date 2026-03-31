import { describe, expect, it } from 'vitest';
import { redactWriterResultByUserRules } from './sessionAssembler';
import type { InterpolatorWriteResult } from '../intelligence/llmContracts';
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
});
