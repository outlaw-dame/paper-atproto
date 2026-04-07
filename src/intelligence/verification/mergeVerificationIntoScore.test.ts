import { describe, expect, it } from 'vitest';

import type { ContributionScores } from '../interpolatorTypes';
import type { VerificationOutcome } from './types';
import { mergeVerificationIntoContributionScore } from './mergeVerificationIntoScore';

function makeScore(): ContributionScores {
  return {
    uri: 'at://reply/1',
    role: 'new_information',
    finalInfluenceScore: 0.4,
    clarificationValue: 0.2,
    sourceSupport: 0.3,
    visibleChips: [],
    factual: null,
    usefulnessScore: 0.4,
    abuseScore: 0,
    evidenceSignals: [],
    entityImpacts: [
      {
        entityText: 'A.I.',
        entityKind: 'concept',
        sentimentShift: 0,
        isNewEntity: true,
        mentionCount: 1,
        matchConfidence: 0.4,
      },
    ],
    scoredAt: '2026-04-07T00:00:00.000Z',
  };
}

function makeVerification(): VerificationOutcome {
  return {
    request: {
      postUri: 'at://reply/1',
      text: 'AI changed the conversation.',
    },
    extractedClaims: {
      claims: [],
    },
    factCheck: null,
    grounding: null,
    media: null,
    claimType: 'factual_assertion',
    sourceType: 'none',
    citedUrls: [],
    quotedTextSpans: [],
    checkability: 0.3,
    sourcePresence: 0,
    sourceQuality: 0,
    quoteFidelity: 0,
    specificity: 0.3,
    contextValue: 0.2,
    entityGrounding: 0.4,
    correctionValue: 0,
    corroborationLevel: 0,
    contradictionLevel: 0,
    mediaContextConfidence: 0,
    factualContributionScore: 0.4,
    factualConfidence: 0.7,
    factualState: 'partially-supported',
    reasons: ['entity-grounded'],
    canonicalEntities: [
      {
        mention: 'AI',
        canonicalId: 'wikidata:Q11660',
        canonicalLabel: 'Artificial intelligence',
        confidence: 0.9,
        provider: 'wikidata',
      },
    ],
    diagnostics: {
      providerFailures: [],
      latencyMs: 12,
    },
  };
}

describe('mergeVerificationIntoContributionScore', () => {
  it('upgrades entity impacts from canonical entities using normalized mention matching', () => {
    const merged = mergeVerificationIntoContributionScore(makeScore(), makeVerification());

    expect(merged.entityImpacts[0]?.canonicalEntityId).toBe('wikidata:Q11660');
    expect(merged.entityImpacts[0]?.canonicalLabel).toBe('Artificial intelligence');
    expect(merged.entityImpacts[0]?.matchConfidence).toBeGreaterThan(0.65);
    expect(merged.visibleChips.some((chip) => chip.kind === 'partially-supported')).toBe(true);
  });

  it('leaves unrelated entity impacts unchanged when no canonical match exists', () => {
    const score = makeScore();
    score.entityImpacts[0] = {
      entityText: 'Completely unrelated topic',
      entityKind: 'concept',
      sentimentShift: 0,
      isNewEntity: true,
      mentionCount: 1,
      matchConfidence: 0.33,
    };

    const merged = mergeVerificationIntoContributionScore(score, makeVerification());

    expect(merged.entityImpacts[0]?.canonicalEntityId).toBeUndefined();
    expect(merged.entityImpacts[0]?.matchConfidence).toBe(0.33);
  });
});