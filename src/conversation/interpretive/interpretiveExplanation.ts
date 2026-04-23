import type { SummaryMode } from '../../intelligence/llmContracts';
import type {
  InterpretiveConfidenceExplanation,
  InterpretiveConfidenceFactors,
  InterpretiveFactorContribution,
  InterpretiveFactorId,
} from '../sessionTypes';
import type {
  AppliedInterpretiveGate,
  InterpretiveGateReason,
} from './interpretiveGates';

const INTERPRETIVE_FACTOR_IDS: InterpretiveFactorId[] = [
  'semanticCoherence',
  'evidenceAdequacy',
  'contextCompleteness',
  'perspectiveBreadth',
  'ambiguityPenalty',
  'contradictionPenalty',
  'repetitionPenalty',
  'heatPenalty',
  'coverageGapPenalty',
  'freshnessPenalty',
  'sourceIntegritySupport',
  'userLabelSupport',
  'signalAgreement',
];

const PENALTY_FACTORS = new Set<InterpretiveFactorId>([
  'ambiguityPenalty',
  'contradictionPenalty',
  'repetitionPenalty',
  'heatPenalty',
  'coverageGapPenalty',
  'freshnessPenalty',
]);

const POSITIVE_FACTOR_LABELS: Record<
  keyof Pick<
    InterpretiveConfidenceFactors,
    | 'semanticCoherence'
    | 'evidenceAdequacy'
    | 'contextCompleteness'
    | 'perspectiveBreadth'
    | 'sourceIntegritySupport'
    | 'userLabelSupport'
    | 'signalAgreement'
  >,
  { code: string; label: string }
> = {
  semanticCoherence: { code: 'semantic_coherence', label: 'coherent theme' },
  evidenceAdequacy: { code: 'evidence_adequacy', label: 'adequate evidence' },
  contextCompleteness: { code: 'context_completeness', label: 'complete context' },
  perspectiveBreadth: { code: 'perspective_breadth', label: 'multiple perspectives' },
  sourceIntegritySupport: { code: 'source_integrity', label: 'credible source support' },
  userLabelSupport: { code: 'user_labels', label: 'aligned user feedback' },
  signalAgreement: { code: 'signal_agreement', label: 'consistent signals' },
};

const FACTOR_LABELS: Record<InterpretiveFactorId, string> = {
  semanticCoherence: 'Coherent theme',
  evidenceAdequacy: 'Strong evidence',
  contextCompleteness: 'Good context',
  perspectiveBreadth: 'Multiple perspectives',
  ambiguityPenalty: 'Ambiguous discussion',
  contradictionPenalty: 'Conflicting claims',
  repetitionPenalty: 'Repeated points',
  heatPenalty: 'Heated tone',
  coverageGapPenalty: 'Limited coverage',
  freshnessPenalty: 'Still developing',
  sourceIntegritySupport: 'Credible sources',
  userLabelSupport: 'User feedback aligned',
  signalAgreement: 'Consistent signals',
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
  model_agreement: 'consistent signals',
};

export function buildInterpretiveExplanation(params: {
  score: number;
  mode: SummaryMode;
  factors: InterpretiveConfidenceFactors;
  gates: AppliedInterpretiveGate[];
  weights: Record<string, number>;
}): InterpretiveConfidenceExplanation {
  const { score, mode, factors, gates, weights } = params;

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

  const contributions = buildFactorContributions(factors, weights);
  const primaryReasons = derivePrimaryReasons(contributions, gates);

  return {
    score,
    mode,
    factors,
    rationale,
    boostedBy,
    degradedBy,
    schemaVersion: 2,
    contributions,
    primaryReasons,
    v2: {
      schemaVersion: 2,
      contributions,
      primaryReasons,
    },
  };
}

export function humanizeInterpretiveReason(code: string): string {
  return DEGRADATION_LABELS[code]
    ?? Object.values(POSITIVE_FACTOR_LABELS).find((entry) => entry.code === code)?.label
    ?? code.replace(/_/g, ' ');
}

export function humanizeInterpretiveFactorId(factor: InterpretiveFactorId): string {
  return FACTOR_LABELS[factor] ?? factor.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function buildFactorContributions(
  factors: InterpretiveConfidenceFactors,
  weights: Record<string, number>,
): InterpretiveFactorContribution[] {
  return INTERPRETIVE_FACTOR_IDS.map((factor) => {
    const value = factorValue(factors, factor);
    const weight = weights[factor] ?? 0;
    const centered = PENALTY_FACTORS.has(factor)
      ? 0.5 - value
      : value - 0.5;
    const delta = clamp(-1, 1, centered * weight * 2);

    return {
      factor,
      delta,
      direction: directionFromDelta(delta),
      severity: severityFromDelta(delta),
      evidence: {
        magnitude: magnitudeFromValue(value),
      },
    };
  });
}

export function derivePrimaryReasons(
  contributions: InterpretiveFactorContribution[],
  gates: AppliedInterpretiveGate[] = [],
): InterpretiveFactorId[] {
  const gateReasons = gates
    .map((gate): InterpretiveFactorId | null => {
      switch (gate.reason) {
        case 'insufficient_context':
        case 'shallow_thread':
          return 'contextCompleteness';
        case 'low_evidence_high_ambiguity':
          return 'ambiguityPenalty';
        case 'rapid_contradiction_without_support':
          return 'contradictionPenalty';
      }
    })
    .filter((factor): factor is InterpretiveFactorId => factor !== null);

  const ranked = contributions
    .filter((contribution) => contribution.severity !== 'minor')
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
    .map((contribution) => contribution.factor);

  return [...new Set([...gateReasons, ...ranked])].slice(0, 3);
}

function rankPositiveFactors(
  factors: InterpretiveConfidenceFactors,
): Array<{ code: string; value: number }> {
  return (Object.entries(POSITIVE_FACTOR_LABELS) as Array<
    [keyof typeof POSITIVE_FACTOR_LABELS, { code: string; label: string }]
  >)
    .map(([key, value]) => ({
      code: value.code,
      value: factorValue(factors, key),
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

function factorValue(
  factors: InterpretiveConfidenceFactors,
  factor: InterpretiveFactorId,
): number {
  if (factor === 'signalAgreement') {
    return factors.signalAgreement ?? factors.modelAgreement ?? 0;
  }
  return factors[factor];
}

function severityFromDelta(delta: number): 'minor' | 'moderate' | 'major' {
  const abs = Math.abs(delta);
  if (abs >= 0.25) return 'major';
  if (abs >= 0.12) return 'moderate';
  return 'minor';
}

function directionFromDelta(delta: number): 'support' | 'limit' {
  return delta >= 0 ? 'support' : 'limit';
}

function magnitudeFromValue(value: number): 'low' | 'medium' | 'high' {
  if (value > 0.75) return 'high';
  if (value > 0.5) return 'medium';
  return 'low';
}

function clamp(min: number, max: number, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
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
