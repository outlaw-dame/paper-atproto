import type { SummaryMode } from '../../intelligence/llmContracts';
import {
  INTERPRETIVE_CONFIDENCE_WEIGHTS,
  INTERPRETIVE_SUMMARY_MODE_THRESHOLDS,
} from '../sessionPolicies';
import type {
  ConversationSession,
  InterpretiveConfidenceExplanation,
  InterpolatorConfidence,
} from '../sessionTypes';
import { buildInterpretiveExplanation } from './interpretiveExplanation';
import {
  applyInterpretiveCaps,
  type AppliedInterpretiveGate,
} from './interpretiveGates';
import {
  computeInterpretiveFactors,
  type InterpretiveFactorComputation,
} from './interpretiveFactors';

export type InterpretiveDisagreementType = 'factual' | 'interpretive' | 'value-based';

export interface InterpretiveConfidenceComputation {
  confidence: InterpolatorConfidence;
  explanation: InterpretiveConfidenceExplanation;
  diagnostics: InterpretiveFactorComputation['diagnostics'];
  gates: AppliedInterpretiveGate[];
}

export function chooseInterpretiveSummaryMode(score: number): SummaryMode {
  if (score >= INTERPRETIVE_SUMMARY_MODE_THRESHOLDS.normal) {
    return 'normal';
  }
  if (score >= INTERPRETIVE_SUMMARY_MODE_THRESHOLDS.descriptiveFallback) {
    return 'descriptive_fallback';
  }
  return 'minimal_fallback';
}

export function computeInterpretiveConfidenceForSession(
  session: ConversationSession,
): InterpretiveConfidenceComputation {
  const factorComputation = computeInterpretiveFactors(session);
  const factors = factorComputation.factors;

  const weightedScore = clamp01(
    INTERPRETIVE_CONFIDENCE_WEIGHTS.semanticCoherence * factors.semanticCoherence
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.evidenceAdequacy * factors.evidenceAdequacy
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.contextCompleteness * factors.contextCompleteness
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.perspectiveBreadth * factors.perspectiveBreadth
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.sourceIntegritySupport * factors.sourceIntegritySupport
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.userLabelSupport * factors.userLabelSupport
    + INTERPRETIVE_CONFIDENCE_WEIGHTS.modelAgreement * factors.modelAgreement
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.ambiguityPenalty * factors.ambiguityPenalty
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.contradictionPenalty * factors.contradictionPenalty
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.repetitionPenalty * factors.repetitionPenalty
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.heatPenalty * factors.heatPenalty
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.coverageGapPenalty * factors.coverageGapPenalty
    - INTERPRETIVE_CONFIDENCE_WEIGHTS.freshnessPenalty * factors.freshnessPenalty,
  );

  const gated = applyInterpretiveCaps(weightedScore, {
    hasRoot: factorComputation.diagnostics.hasRoot,
    contextCompleteness: factors.contextCompleteness,
    evidenceAdequacy: factors.evidenceAdequacy,
    ambiguityPenalty: factors.ambiguityPenalty,
    contradictionPenalty: factors.contradictionPenalty,
    modelAgreement: factors.modelAgreement,
    visibleContributionCount: factorComputation.diagnostics.visibleContributionCount,
  });

  const mode = chooseInterpretiveSummaryMode(gated.score);
  const explanation = buildInterpretiveExplanation({
    score: gated.score,
    mode,
    factors,
    gates: gated.gates,
  });

  const baseConfidence = session.interpretation.confidence;
  const confidence: InterpolatorConfidence = {
    surfaceConfidence: baseConfidence?.surfaceConfidence ?? 0,
    entityConfidence: baseConfidence?.entityConfidence ?? 0,
    interpretiveConfidence: explanation.score,
  };

  return {
    confidence,
    explanation,
    diagnostics: factorComputation.diagnostics,
    gates: gated.gates,
  };
}

export function applyInterpretiveConfidence(
  session: ConversationSession,
): ConversationSession {
  const computation = computeInterpretiveConfidenceForSession(session);

  return {
    ...session,
    interpretation: {
      ...session.interpretation,
      confidence: computation.confidence,
      interpretiveExplanation: computation.explanation,
    },
  };
}

export function deriveDisagreementType(
  explanation: InterpretiveConfidenceExplanation | null | undefined,
): InterpretiveDisagreementType {
  if (!explanation) return 'interpretive';

  if (
    explanation.factors.contradictionPenalty >= 0.55
    && explanation.factors.evidenceAdequacy >= 0.45
  ) {
    return 'factual';
  }

  if (
    explanation.factors.perspectiveBreadth >= 0.45
    && explanation.factors.ambiguityPenalty < 0.6
  ) {
    return 'interpretive';
  }

  return 'value-based';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
