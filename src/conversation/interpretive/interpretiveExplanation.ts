import type { SummaryMode } from '../../intelligence/llmContracts';
import type {
  InterpretiveConfidenceExplanation,
  InterpretiveConfidenceFactors,
} from '../sessionTypes';
import type {
  AppliedInterpretiveGate,
  InterpretiveGateReason,
} from './interpretiveGates';

const POSITIVE_FACTOR_LABELS: Record<
  keyof Pick<
    InterpretiveConfidenceFactors,
    | 'semanticCoherence'
    | 'evidenceAdequacy'
    | 'contextCompleteness'
    | 'perspectiveBreadth'
    | 'sourceIntegritySupport'
    | 'userLabelSupport'
    | 'modelAgreement'
  >,
  { code: string; label: string }
> = {
  semanticCoherence: { code: 'semantic_coherence', label: 'coherent theme' },
  evidenceAdequacy: { code: 'evidence_adequacy', label: 'adequate evidence' },
  contextCompleteness: { code: 'context_completeness', label: 'complete context' },
  perspectiveBreadth: { code: 'perspective_breadth', label: 'multiple perspectives' },
  sourceIntegritySupport: { code: 'source_integrity', label: 'credible source support' },
  userLabelSupport: { code: 'user_labels', label: 'aligned user feedback' },
  modelAgreement: { code: 'model_agreement', label: 'consistent signals' },
};

const GATE_DEGRADATIONS: Record<InterpretiveGateReason, { code: string; label: string }> = {
  insufficient_context: { code: 'missing_context', label: 'missing context' },
  low_evidence_high_ambiguity: { code: 'high_ambiguity', label: 'high ambiguity' },
  rapid_contradiction_without_support: { code: 'unresolved_contradiction', label: 'unresolved contradiction' },
  shallow_thread: { code: 'shallow_thread', label: 'shallow thread depth' },
};

const DEGRADATION_LABELS: Record<string, string> = {
  missing_context: 'missing context',
  limited_evidence: 'limited evidence',
  narrow_perspective: 'narrow perspective coverage',
  high_ambiguity: 'high ambiguity',
  unresolved_contradiction: 'unresolved contradiction',
  heavy_repetition: 'heavy repetition',
  escalated_heat: 'escalated heat',
  coverage_gap: 'coverage gaps',
  fresh_context: 'fast-moving context',
  shallow_thread: 'shallow thread depth',
};

export function buildInterpretiveExplanation(params: {
  score: number;
  mode: SummaryMode;
  factors: InterpretiveConfidenceFactors;
  gates: AppliedInterpretiveGate[];
}): InterpretiveConfidenceExplanation {
  const { score, mode, factors, gates } = params;

  const boostedBy = rankPositiveFactors(factors)
    .filter((entry) => entry.value >= 0.58)
    .slice(0, 3)
    .map((entry) => entry.code);

  const degradedBy = [
    ...new Set([
      ...rankNegativeFactors(factors)
        .filter((entry) => entry.value >= 0.45)
        .slice(0, 4)
        .map((entry) => entry.code),
      ...gates.map((gate) => GATE_DEGRADATIONS[gate.reason].code),
    ]),
  ];

  const rationale: string[] = [];

  if (boostedBy.length > 0) {
    rationale.push(`Interpretation is supported by ${formatLabels(boostedBy, humanizeInterpretiveReason)}.`);
  }

  if (degradedBy.length > 0) {
    rationale.push(`Confidence is limited by ${formatLabels(degradedBy, humanizeInterpretiveReason)}.`);
  }

  rationale.push(modeRationale(mode, score));

  return {
    score,
    mode,
    factors,
    rationale,
    boostedBy,
    degradedBy,
  };
}

export function humanizeInterpretiveReason(code: string): string {
  return DEGRADATION_LABELS[code]
    ?? Object.values(POSITIVE_FACTOR_LABELS).find((entry) => entry.code === code)?.label
    ?? code.replace(/_/g, ' ');
}

function rankPositiveFactors(
  factors: InterpretiveConfidenceFactors,
): Array<{ code: string; value: number }> {
  return (Object.entries(POSITIVE_FACTOR_LABELS) as Array<
    [keyof typeof POSITIVE_FACTOR_LABELS, { code: string; label: string }]
  >)
    .map(([key, value]) => ({
      code: value.code,
      value: factors[key],
    }))
    .sort((left, right) => right.value - left.value);
}

function rankNegativeFactors(
  factors: InterpretiveConfidenceFactors,
): Array<{ code: string; value: number }> {
  const candidates = [
    { code: 'missing_context', value: 1 - factors.contextCompleteness },
    { code: 'limited_evidence', value: 1 - factors.evidenceAdequacy },
    { code: 'narrow_perspective', value: 1 - factors.perspectiveBreadth },
    { code: 'high_ambiguity', value: factors.ambiguityPenalty },
    { code: 'unresolved_contradiction', value: factors.contradictionPenalty },
    { code: 'heavy_repetition', value: factors.repetitionPenalty },
    { code: 'escalated_heat', value: factors.heatPenalty },
    { code: 'coverage_gap', value: factors.coverageGapPenalty },
    { code: 'fresh_context', value: factors.freshnessPenalty },
  ];

  return candidates.sort((left, right) => right.value - left.value);
}

function modeRationale(mode: SummaryMode, score: number): string {
  switch (mode) {
    case 'normal':
      return score >= 0.85
        ? 'A full interpretive summary is justified.'
        : 'Interpretive claims should stay measured rather than absolute.';
    case 'descriptive_fallback':
      return 'Language should stay descriptive and avoid deeper causal framing.';
    case 'minimal_fallback':
      return 'Only minimal, observable thread description is warranted.';
    default:
      return 'Confidence is being routed conservatively.';
  }
}

function formatLabels(
  codes: string[],
  labelFor: (code: string) => string,
): string {
  const labels = codes.map(labelFor);
  if (labels.length <= 1) return labels[0] ?? 'limited signal';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}
