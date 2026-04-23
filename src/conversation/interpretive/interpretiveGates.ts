import { INTERPRETIVE_CONFIDENCE_GATES } from '../sessionPolicies';

export type InterpretiveGateReason =
  | 'insufficient_context'
  | 'low_evidence_high_ambiguity'
  | 'rapid_contradiction_without_support'
  | 'shallow_thread';

export interface InterpretiveGateInputs {
  hasRoot: boolean;
  contextCompleteness: number;
  evidenceAdequacy: number;
  ambiguityPenalty: number;
  contradictionPenalty: number;
  signalAgreement: number;
  visibleContributionCount: number;
}

export interface AppliedInterpretiveGate {
  reason: InterpretiveGateReason;
  cap: number;
}

export function applyInterpretiveCaps(
  score: number,
  input: InterpretiveGateInputs,
): { score: number; gates: AppliedInterpretiveGate[] } {
  const gates: AppliedInterpretiveGate[] = [];

  if (!input.hasRoot || input.contextCompleteness < INTERPRETIVE_CONFIDENCE_GATES.contextCompletenessFloor) {
    gates.push({
      reason: 'insufficient_context',
      cap: INTERPRETIVE_CONFIDENCE_GATES.insufficientContextCap,
    });
  }

  if (
    input.evidenceAdequacy < INTERPRETIVE_CONFIDENCE_GATES.evidenceAdequacyFloor
    && input.ambiguityPenalty > INTERPRETIVE_CONFIDENCE_GATES.ambiguityCeiling
  ) {
    gates.push({
      reason: 'low_evidence_high_ambiguity',
      cap: INTERPRETIVE_CONFIDENCE_GATES.lowEvidenceHighAmbiguityCap,
    });
  }

  if (
    input.contradictionPenalty > INTERPRETIVE_CONFIDENCE_GATES.contradictionCeiling
    && input.signalAgreement < INTERPRETIVE_CONFIDENCE_GATES.signalAgreementFloor
  ) {
    gates.push({
      reason: 'rapid_contradiction_without_support',
      cap: INTERPRETIVE_CONFIDENCE_GATES.rapidContradictionCap,
    });
  }

  if (input.visibleContributionCount < INTERPRETIVE_CONFIDENCE_GATES.shallowThreadNodeCount) {
    gates.push({
      reason: 'shallow_thread',
      cap: INTERPRETIVE_CONFIDENCE_GATES.shallowThreadCap,
    });
  }

  const cappedScore = gates.reduce(
    (current, gate) => Math.min(current, gate.cap),
    clamp01(score),
  );

  return {
    score: cappedScore,
    gates,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
