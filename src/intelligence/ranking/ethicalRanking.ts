export type RankingInteractionSignal = 'expand' | 'dwell' | 'skip';

export interface RankingFeedbackState {
  impressions: number;
  expansions: number;
  dwellSeconds: number;
  skips: number;
}

export interface BaseRankingInput {
  interpretiveConfidence: number;
  recency: number;
  engagement: number;
}

export interface EthicalRankingInput {
  interpretiveConfidence: number;
  recency: number;
  coverageGap: number;
  diversityScore: number;
  engagement?: number;
  feedback?: RankingFeedbackState;
}

export interface BaseRankingResult {
  score: number;
  interpretiveContribution: number;
  recencyContribution: number;
  engagementScore: number;
  engagementEffect: number;
  engagementContribution: number;
}

export interface EthicalRankingExplanation extends BaseRankingResult {
  finalScore: number;
  diversityAdjustment: number;
  coverageGapAdjustment: number;
  confidenceFloorAdjustment: number;
  appliedGuardrails: EthicalRankingGuardrail[];
}

export interface EthicalRankingResult {
  score: number;
  explanation: EthicalRankingExplanation;
}

export type EthicalRankingGuardrail =
  | 'low_diversity'
  | 'coverage_gap'
  | 'confidence_floor';

export const ETHICAL_RANKING_POLICY = {
  interpretiveWeight: 0.6,
  recencyWeight: 0.2,
  engagementWeight: 0.2,
  maxEngagementInfluenceRate: 0.2,
  targetDwellSecondsPerImpression: 8,
  diversityFloor: 0.3,
  coverageGapLimit: 0.6,
  confidenceFloor: 0.4,
  lowDiversityPenalty: 0.1,
  coverageGapPenalty: 0.15,
  confidenceFloorPenalty: 0.2,
} as const;

export function createRankingFeedbackState(
  overrides: Partial<RankingFeedbackState> = {},
): RankingFeedbackState {
  return {
    impressions: sanitizeCount(overrides.impressions ?? 0),
    expansions: sanitizeCount(overrides.expansions ?? 0),
    dwellSeconds: sanitizeSeconds(overrides.dwellSeconds ?? 0),
    skips: sanitizeCount(overrides.skips ?? 0),
  };
}

export function recordRankingImpression(
  state: RankingFeedbackState,
): RankingFeedbackState {
  const current = createRankingFeedbackState(state);
  return {
    ...current,
    impressions: current.impressions + 1,
  };
}

export function recordRankingInteraction(
  state: RankingFeedbackState,
  signal: RankingInteractionSignal,
  options: { dwellSeconds?: number } = {},
): RankingFeedbackState {
  const current = createRankingFeedbackState(state);
  switch (signal) {
    case 'expand':
      return {
        ...current,
        expansions: current.expansions + 1,
      };
    case 'dwell':
      return {
        ...current,
        dwellSeconds: current.dwellSeconds + sanitizeSeconds(options.dwellSeconds ?? 0),
      };
    case 'skip':
      return {
        ...current,
        skips: current.skips + 1,
      };
  }
}

export function computeEngagementScore(feedback: RankingFeedbackState): number {
  const state = createRankingFeedbackState(feedback);
  if (state.impressions === 0) return 0.5;

  const impressions = Math.max(1, state.impressions);
  const expandRate = clamp01(state.expansions / impressions);
  const dwellFactor = clamp01(
    state.dwellSeconds / (impressions * ETHICAL_RANKING_POLICY.targetDwellSecondsPerImpression),
  );
  const skipRate = clamp01(state.skips / impressions);

  const positiveSignal = (0.6 * expandRate) + (0.4 * dwellFactor);
  return clamp01((0.5 * positiveSignal) + (0.5 * (1 - skipRate)));
}

export function clampEngagementEffect(
  engagement: number,
  interpretiveConfidence: number,
): number {
  const confidence = clamp01(interpretiveConfidence);
  const maxInfluence = ETHICAL_RANKING_POLICY.maxEngagementInfluenceRate * confidence;
  return clampSymmetric(clamp01(engagement) - 0.5, maxInfluence);
}

export function computeBaseRankingScore(input: BaseRankingInput): BaseRankingResult {
  const interpretiveConfidence = clamp01(input.interpretiveConfidence);
  const recency = clamp01(input.recency);
  const engagementScore = clamp01(input.engagement);
  const engagementEffect = clampEngagementEffect(engagementScore, interpretiveConfidence);
  const interpretiveContribution = ETHICAL_RANKING_POLICY.interpretiveWeight * interpretiveConfidence;
  const recencyContribution = ETHICAL_RANKING_POLICY.recencyWeight * recency;
  const engagementContribution = ETHICAL_RANKING_POLICY.engagementWeight * (0.5 + engagementEffect);

  return {
    score: clamp01(interpretiveContribution + recencyContribution + engagementContribution),
    interpretiveContribution,
    recencyContribution,
    engagementScore,
    engagementEffect,
    engagementContribution,
  };
}

export function computeEthicalRankingScore(input: EthicalRankingInput): EthicalRankingResult {
  const engagement = typeof input.engagement === 'number'
    ? input.engagement
    : computeEngagementScore(input.feedback ?? createRankingFeedbackState());
  const base = computeBaseRankingScore({
    interpretiveConfidence: input.interpretiveConfidence,
    recency: input.recency,
    engagement,
  });
  const constrained = enforceEthicalRankingConstraints({
    rankingScore: base.score,
    interpretiveConfidence: input.interpretiveConfidence,
    coverageGap: input.coverageGap,
    diversityScore: input.diversityScore,
  });

  return {
    score: constrained.score,
    explanation: {
      ...base,
      finalScore: constrained.score,
      diversityAdjustment: constrained.diversityAdjustment,
      coverageGapAdjustment: constrained.coverageGapAdjustment,
      confidenceFloorAdjustment: constrained.confidenceFloorAdjustment,
      appliedGuardrails: constrained.appliedGuardrails,
    },
  };
}

export function enforceEthicalRankingConstraints(input: {
  rankingScore: number;
  interpretiveConfidence: number;
  coverageGap: number;
  diversityScore: number;
}): {
  score: number;
  diversityAdjustment: number;
  coverageGapAdjustment: number;
  confidenceFloorAdjustment: number;
  appliedGuardrails: EthicalRankingGuardrail[];
} {
  let score = clamp01(input.rankingScore);
  const appliedGuardrails: EthicalRankingGuardrail[] = [];
  let diversityAdjustment = 0;
  let coverageGapAdjustment = 0;
  let confidenceFloorAdjustment = 0;

  if (clamp01(input.diversityScore) < ETHICAL_RANKING_POLICY.diversityFloor) {
    const nextScore = score * (1 - ETHICAL_RANKING_POLICY.lowDiversityPenalty);
    diversityAdjustment = nextScore - score;
    score = nextScore;
    appliedGuardrails.push('low_diversity');
  }

  if (clamp01(input.coverageGap) > ETHICAL_RANKING_POLICY.coverageGapLimit) {
    const nextScore = score * (1 - ETHICAL_RANKING_POLICY.coverageGapPenalty);
    coverageGapAdjustment = nextScore - score;
    score = nextScore;
    appliedGuardrails.push('coverage_gap');
  }

  if (clamp01(input.interpretiveConfidence) < ETHICAL_RANKING_POLICY.confidenceFloor) {
    const nextScore = score * (1 - ETHICAL_RANKING_POLICY.confidenceFloorPenalty);
    confidenceFloorAdjustment = nextScore - score;
    score = nextScore;
    appliedGuardrails.push('confidence_floor');
  }

  return {
    score: clamp01(score),
    diversityAdjustment,
    coverageGapAdjustment,
    confidenceFloorAdjustment,
    appliedGuardrails,
  };
}

function sanitizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sanitizeSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function clampSymmetric(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
