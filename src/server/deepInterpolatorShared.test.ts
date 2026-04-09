import { describe, expect, it } from 'vitest';

import {
  truncateNarrativeText,
  validateDeepInterpolatorResult,
} from '../../server/src/ai/providers/deepInterpolatorShared.js';

describe('deepInterpolatorShared', () => {
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
    }, 'openai');

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
});
