import { describe, expect, it } from 'vitest';
import {
  evaluateConversationModelQuality,
  evaluateFactCheckQuality,
} from './aiQualityRubric';
import { FACT_CHECK_QUALITY_FIXTURES } from './factCheckQualityFixtures';
import { PREMIUM_PROVIDER_EVAL_FIXTURES } from './premiumProviderFixtures';

describe('AI quality rubrics', () => {
  it('scores fact-check quality above weak when recorded matches are relevant', () => {
    const fixture = FACT_CHECK_QUALITY_FIXTURES[0]!;
    const quality = evaluateFactCheckQuality(fixture, fixture.recordedResult!);

    expect(quality.score).toBeGreaterThanOrEqual(80);
    expect(quality.components.map((component) => component.id)).toContain('match_calibration');
    expect(quality.components.every((component) => Object.keys(component.evidence).length > 0)).toBe(true);
  });

  it('penalizes irrelevant fact-check false positives', () => {
    const fixture = FACT_CHECK_QUALITY_FIXTURES.find((candidate) => candidate.id === 'eiffel-tower-location')!;
    const quality = evaluateFactCheckQuality(fixture, {
      matched: true,
      hits: [
        {
          claimReviewTitle: 'Unrelated vaccine hoax',
          publisher: 'Example',
          textualRating: 'False',
          matchConfidence: 0.9,
        },
      ],
    });

    expect(quality.score).toBeLessThan(70);
  });

  it('scores model output quality on a weighted rubric rather than pass/fail counts', () => {
    const fixture = PREMIUM_PROVIDER_EVAL_FIXTURES[0]!;
    const quality = evaluateConversationModelQuality(fixture, {
      target: 'local-raw',
      summary: '@author.test claims Claude found zero-days in OpenBSD and related projects, while @reply.one questions the lack of a primary advisory or disclosure.',
      groundedContext: '',
      perspectiveGaps: [],
      followUpQuestions: [],
    });

    expect(quality.score).toBeGreaterThanOrEqual(70);
    expect(quality.components.map((component) => component.id)).toContain('evidence_calibration');
    expect(quality.components.every((component) => Object.keys(component.evidence).length > 0)).toBe(true);
  });

  it('penalizes generic overconfident model output when evidence gaps are expected', () => {
    const fixture = PREMIUM_PROVIDER_EVAL_FIXTURES[0]!;
    const quality = evaluateConversationModelQuality(fixture, {
      target: 'gemini',
      summary: 'The thread centers on a confirmed technical discovery that proves the claim.',
      groundedContext: '',
      perspectiveGaps: [],
      followUpQuestions: [],
    });

    expect(quality.score).toBeLessThan(60);
  });
});
