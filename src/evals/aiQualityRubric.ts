export interface QualityComponent {
  id: string;
  label: string;
  weight: number;
  score: number;
  evidence: Record<string, unknown>;
}

export interface QualityScore {
  score: number;
  grade: 'excellent' | 'good' | 'mixed' | 'weak';
  components: QualityComponent[];
}

export interface FactCheckQualityFixture {
  id: string;
  description: string;
  request: {
    text: string;
    languageCode?: string;
    claims?: ReadonlyArray<{
      text: string;
      claimType?: string;
      checkability?: number;
    }>;
  };
  expectations: {
    shouldMatch: boolean;
    expectedTerms: ReadonlyArray<string>;
    expectedRatingTerms?: ReadonlyArray<string>;
    minimumHitCount?: number;
    disallowedTerms?: ReadonlyArray<string>;
  };
  recordedResult?: FactCheckQualityResult;
}

export interface FactCheckQualityResult {
  matched: boolean;
  hits: ReadonlyArray<{
    claimant?: string;
    claimReviewTitle?: string;
    publisher?: string;
    url?: string;
    textualRating?: string;
    matchConfidence?: number;
  }>;
  model?: string;
  latencyMs?: number;
}

export interface ConversationQualityFixture {
  id: string;
  description?: string;
  expectations: {
    mustMentionHandles?: ReadonlyArray<string>;
    minHandleMentions?: number;
    topicKeywords?: ReadonlyArray<string>;
    minTopicKeywordHits?: number;
    requireEvidenceGapLanguage?: boolean;
    requireEvidenceLanguage?: boolean;
    evidenceGapTerms?: ReadonlyArray<string>;
    evidenceTerms?: ReadonlyArray<string>;
  };
}

export interface ConversationQualityResult {
  target: string;
  summary: string;
  groundedContext?: string;
  perspectiveGaps?: ReadonlyArray<string>;
  followUpQuestions?: ReadonlyArray<string>;
}

const DEFAULT_BANNED_PHRASES = [
  'the thread centers on',
  'the thread centres on',
  'the visible discussion',
  'visible replies mostly',
  'the discussion centers on',
  'the discussion centres on',
];

const OVERCLAIM_TERMS = [
  'confirmed',
  'proves',
  'proven',
  'definitively',
  'without question',
];

export function evaluateFactCheckQuality(
  fixture: FactCheckQualityFixture,
  result: FactCheckQualityResult,
): QualityScore {
  const hitText = normalize([
    ...result.hits.flatMap((hit) => [
      hit.claimReviewTitle,
      hit.publisher,
      hit.textualRating,
      hit.url,
      hit.claimant,
    ]),
  ].join(' '));
  const expectedTermHits = countTermHits(hitText, fixture.expectations.expectedTerms);
  const ratingTermHits = countTermHits(hitText, fixture.expectations.expectedRatingTerms ?? []);
  const disallowedHits = countTermHits(hitText, fixture.expectations.disallowedTerms ?? []);
  const publisherCount = new Set(
    result.hits
      .map((hit) => normalize(hit.publisher ?? ''))
      .filter(Boolean),
  ).size;
  const averageConfidence = average(
    result.hits
      .map((hit) => hit.matchConfidence)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    result.matched ? 0.5 : 0,
  );
  const minimumHitCount = fixture.expectations.minimumHitCount ?? (fixture.expectations.shouldMatch ? 1 : 0);

  return weightedQuality([
    {
      id: 'match_calibration',
      label: 'Match calibration',
      weight: 0.30,
      score: result.matched === fixture.expectations.shouldMatch ? 1 : 0,
      evidence: {
        expectedMatch: fixture.expectations.shouldMatch,
        actualMatched: result.matched,
      },
    },
    {
      id: 'hit_relevance',
      label: 'Hit relevance',
      weight: 0.25,
      score: fixture.expectations.expectedTerms.length === 0
        ? 1
        : clamp01(expectedTermHits / fixture.expectations.expectedTerms.length),
      evidence: {
        expectedTermHits,
        expectedTerms: fixture.expectations.expectedTerms.length,
      },
    },
    {
      id: 'rating_signal',
      label: 'Rating signal',
      weight: 0.15,
      score: (fixture.expectations.expectedRatingTerms ?? []).length === 0
        ? 1
        : clamp01(ratingTermHits / (fixture.expectations.expectedRatingTerms ?? []).length),
      evidence: {
        ratingTermHits,
        expectedRatingTerms: fixture.expectations.expectedRatingTerms?.length ?? 0,
      },
    },
    {
      id: 'hit_depth',
      label: 'Hit depth',
      weight: 0.10,
      score: minimumHitCount === 0 ? 1 : clamp01(result.hits.length / minimumHitCount),
      evidence: {
        hitCount: result.hits.length,
        minimumHitCount,
      },
    },
    {
      id: 'source_diversity',
      label: 'Source diversity',
      weight: 0.10,
      score: result.matched ? clamp01(publisherCount / Math.min(2, Math.max(1, result.hits.length))) : 1,
      evidence: {
        publisherCount,
        hitCount: result.hits.length,
      },
    },
    {
      id: 'confidence_calibration',
      label: 'Confidence calibration',
      weight: 0.05,
      score: fixture.expectations.shouldMatch ? clamp01(averageConfidence) : clamp01(1 - averageConfidence),
      evidence: {
        averageConfidence: round(averageConfidence),
      },
    },
    {
      id: 'disallowed_noise',
      label: 'Disallowed noise',
      weight: 0.05,
      score: disallowedHits === 0 ? 1 : 0,
      evidence: {
        disallowedHits,
      },
    },
  ]);
}

export function evaluateConversationModelQuality(
  fixture: ConversationQualityFixture,
  result: ConversationQualityResult,
): QualityScore {
  const summary = sanitizeText(result.summary);
  const combined = normalize([
    summary,
    result.groundedContext,
    ...(result.perspectiveGaps ?? []),
    ...(result.followUpQuestions ?? []),
  ].join(' '));
  const expectations = fixture.expectations;
  const requiredHandles = expectations.mustMentionHandles ?? [];
  const handleHits = requiredHandles.filter((handle) => combined.includes(`@${handle.toLowerCase()}`));
  const topicKeywords = expectations.topicKeywords ?? [];
  const topicHits = countTermHits(combined, topicKeywords);
  const evidenceTerms = expectations.requireEvidenceGapLanguage
    ? expectations.evidenceGapTerms ?? []
    : expectations.evidenceTerms ?? [];
  const evidenceHits = countTermHits(combined, evidenceTerms);
  const bannedHits = countTermHits(normalize(summary), DEFAULT_BANNED_PHRASES);
  const overclaimHits = expectations.requireEvidenceGapLanguage
    ? countTermHits(combined, OVERCLAIM_TERMS)
    : 0;
  const groundedContextLength = sanitizeText(result.groundedContext ?? '').length;
  const gapCount = result.perspectiveGaps?.filter((gap) => sanitizeText(gap).length > 0).length ?? 0;
  const questionCount = result.followUpQuestions?.filter((question) => sanitizeText(question).length > 0).length ?? 0;

  return weightedQuality([
    {
      id: 'summary_integrity',
      label: 'Summary integrity',
      weight: 0.12,
      score: summary.length === 0
        ? 0
        : clamp01(
            0.45 * (summary.length >= 60 ? 1 : summary.length / 60)
            + 0.35 * (/[.!?]$/.test(summary) ? 1 : 0)
            + 0.20 * (summary.includes('...') ? 0 : 1),
          ),
      evidence: {
        summaryChars: summary.length,
        completeSentence: /[.!?]$/.test(summary),
        hasEllipsis: summary.includes('...'),
      },
    },
    {
      id: 'topic_coverage',
      label: 'Topic coverage',
      weight: 0.18,
      score: topicKeywords.length === 0
        ? 1
        : clamp01(topicHits / Math.max(1, expectations.minTopicKeywordHits ?? topicKeywords.length)),
      evidence: {
        topicHits,
        requiredTopicHits: expectations.minTopicKeywordHits ?? topicKeywords.length,
      },
    },
    {
      id: 'participant_attribution',
      label: 'Participant attribution',
      weight: 0.14,
      score: requiredHandles.length === 0
        ? 1
        : clamp01(handleHits.length / Math.max(1, expectations.minHandleMentions ?? requiredHandles.length)),
      evidence: {
        handleHits,
        requiredHandleHits: expectations.minHandleMentions ?? requiredHandles.length,
      },
    },
    {
      id: 'evidence_calibration',
      label: 'Evidence calibration',
      weight: 0.20,
      score: evidenceTerms.length === 0 ? 1 : clamp01(evidenceHits / Math.min(2, evidenceTerms.length)),
      evidence: {
        evidenceHits,
        expectedMode: expectations.requireEvidenceGapLanguage ? 'gap-aware' : 'evidence-aware',
      },
    },
    {
      id: 'specificity',
      label: 'Specificity',
      weight: 0.12,
      score: clamp01((topicHits + handleHits.length + evidenceHits) / 6),
      evidence: {
        topicHits,
        handleHits: handleHits.length,
        evidenceHits,
      },
    },
    {
      id: 'non_genericness',
      label: 'Non-genericness',
      weight: 0.10,
      score: bannedHits === 0 ? 1 : Math.max(0, 1 - bannedHits * 0.35),
      evidence: {
        bannedHits,
      },
    },
    {
      id: 'overclaim_control',
      label: 'Overclaim control',
      weight: 0.08,
      score: overclaimHits === 0 ? 1 : Math.max(0, 1 - overclaimHits * 0.4),
      evidence: {
        overclaimHits,
        evidenceGapExpected: Boolean(expectations.requireEvidenceGapLanguage),
      },
    },
    {
      id: 'deep_output_utility',
      label: 'Deep output utility',
      weight: 0.06,
      score: result.target.startsWith('local')
        ? 1
        : clamp01(
            0.45 * Math.min(1, groundedContextLength / 140)
            + 0.30 * Math.min(1, gapCount / 2)
            + 0.25 * Math.min(1, questionCount / 2),
          ),
      evidence: {
        groundedContextChars: groundedContextLength,
        perspectiveGapCount: gapCount,
        followUpQuestionCount: questionCount,
        target: result.target,
      },
    },
  ]);
}

function weightedQuality(components: QualityComponent[]): QualityScore {
  const weightTotal = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = weightTotal === 0
    ? 0
    : components.reduce((sum, component) => sum + component.score * component.weight, 0) / weightTotal;
  const score = Math.round(clamp01(weighted) * 1000) / 10;

  return {
    score,
    grade: gradeForScore(score),
    components: components.map((component) => ({
      ...component,
      score: round(component.score),
    })),
  };
}

function gradeForScore(score: number): QualityScore['grade'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'mixed';
  return 'weak';
}

function countTermHits(text: string, terms: ReadonlyArray<string>): number {
  return terms.filter((term) => text.includes(term.toLowerCase())).length;
}

function sanitizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: unknown): string {
  return sanitizeText(value).toLowerCase();
}

function average(values: number[], fallback = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
