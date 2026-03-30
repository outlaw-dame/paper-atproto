import type { SentimentResult } from '../../lib/sentiment';
import type { AbuseModelResult } from '../../lib/abuseModel';
import type { ComposerMLSignals } from './classifierContracts';
import type {
  ComposerGuidanceLevel,
  ComposerGuidanceResult,
  ComposerGuidanceScores,
  ComposerGuidanceTool,
  ComposerGuidanceUiState,
  ComposerMode,
} from './types';

const WARNING_NEGATIVE_THRESHOLD = 0.65;
const CAUTION_NEGATIVE_THRESHOLD = 0.42;
const POSITIVE_SIGNAL_THRESHOLD = 0.62;
const LOW_NEGATIVE_THRESHOLD = 0.35;
const ABUSE_WARNING_THRESHOLD = 0.72;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function heuristicConstructivePrior(heuristics: SentimentResult): number {
  if (heuristics.constructiveSignals.length === 0) return 0;
  return clamp01(0.56 + ((heuristics.constructiveSignals.length - 1) * 0.12));
}

function heuristicSupportivePrior(heuristics: SentimentResult): number {
  if (heuristics.supportiveReplySignals.length === 0) return 0;
  return clamp01(0.6 + ((heuristics.supportiveReplySignals.length - 1) * 0.12));
}

function heuristicClarifyingPrior(heuristics: SentimentResult): number {
  const clueCount = heuristics.constructiveSignals.length + heuristics.supportiveReplySignals.length;
  if (clueCount === 0) return 0;
  return clamp01(0.38 + (heuristics.constructiveSignals.length * 0.14));
}

function heuristicHostilityPrior(heuristics: SentimentResult): number {
  if (heuristics.level !== 'warn') return 0;

  const joined = heuristics.signals.join(' ').toLowerCase();
  if (/\b(hostile|threat|insult|abusive|demeaning|personal attack|attack)\b/.test(joined)) {
    return 0.7;
  }
  if (/\b(dismissive|vulgar|aggressive)\b/.test(joined)) {
    return 0.58;
  }

  return 0.48;
}

function heuristicDismissivePrior(heuristics: SentimentResult): number {
  const joined = heuristics.signals.join(' ').toLowerCase();
  if (/\b(dismissive|criticizing the point instead|criticizing the point)\b/.test(joined)) {
    return 0.54;
  }
  if (/\b(sharp|blunt|short takes)\b/.test(joined)) {
    return 0.32;
  }

  return 0;
}

function heuristicEscalationPrior(heuristics: SentimentResult): number {
  const parentBoost = heuristics.parentSignals.length > 0 ? 0.12 : 0;

  if (heuristics.level === 'warn') {
    return clamp01(0.4 + parentBoost);
  }

  if (heuristics.isReplyContext && heuristics.parentSignals.length > 0) {
    return clamp01(0.22 + parentBoost);
  }

  return 0;
}

function emotionScore(ml: ComposerMLSignals, label: 'anger' | 'trust' | 'optimism'): number {
  const hit = ml.emotions?.find((emotion) => emotion.label === label);
  return clamp01(hit?.score ?? 0);
}

function targetedNegativityScore(ml: ComposerMLSignals): number {
  const targeted = ml.targetedTone;
  if (!targeted) return 0;

  if (targeted.label === 'strongly_negative') return clamp01(targeted.confidence);
  if (targeted.label === 'negative') return clamp01(targeted.confidence * 0.82);
  if (targeted.label === 'negative_or_neutral') return clamp01(targeted.confidence * 0.45);

  return 0;
}

function sentimentPositiveScore(ml: ComposerMLSignals): number {
  if (!ml.sentiment) return 0;
  if (ml.sentiment.label !== 'positive') return 0;
  return clamp01(ml.sentiment.confidence);
}

function sentimentNegativeScore(ml: ComposerMLSignals): number {
  if (!ml.sentiment) return 0;
  if (ml.sentiment.label !== 'negative') return 0;
  return clamp01(ml.sentiment.confidence);
}

function qualityScore(
  ml: ComposerMLSignals,
  heuristicsValue: number,
  key: keyof NonNullable<ComposerMLSignals['conversationQuality']>,
): number {
  return clamp01(Math.max(heuristicsValue, ml.conversationQuality?.[key] ?? 0));
}

export function createEmptyComposerGuidanceScores(): ComposerGuidanceScores {
  return {
    positiveSignal: 0,
    negativeSignal: 0,
    supportiveness: 0,
    constructiveness: 0,
    clarifying: 0,
    hostility: 0,
    dismissiveness: 0,
    escalation: 0,
    sentimentPositive: 0,
    sentimentNegative: 0,
    anger: 0,
    trust: 0,
    optimism: 0,
    targetedNegativity: 0,
    toxicity: 0,
  };
}

export function createEmptyComposerGuidanceResult(mode: ComposerMode): ComposerGuidanceResult {
  return {
    mode,
    level: 'ok',
    heuristics: {
      level: 'ok',
      signals: [],
      constructiveSignals: [],
      supportiveReplySignals: [],
      parentSignals: [],
      isReplyContext: false,
      hasMentalHealthCrisis: false,
    },
    ml: {},
    scores: createEmptyComposerGuidanceScores(),
    toolsUsed: ['heuristic'],
    abuseScore: null,
    ui: {
      state: 'neutral',
      title: mode === 'hosted_thread' ? 'Prompt guidance' : 'Tone check',
      message: '',
      badges: [],
      footnote: '',
      copySource: 'template',
    },
  };
}

export function hasVisibleComposerGuidance(result: ComposerGuidanceResult): boolean {
  return result.level !== 'ok' || result.heuristics.parentSignals.length > 0;
}

export function computeComposerGuidanceScores(
  heuristics: SentimentResult,
  ml: ComposerMLSignals,
  abuseScore: AbuseModelResult | null,
): ComposerGuidanceScores {
  const supportiveness = qualityScore(ml, heuristicSupportivePrior(heuristics), 'supportive');
  const constructiveness = qualityScore(ml, heuristicConstructivePrior(heuristics), 'constructive');
  const clarifying = qualityScore(ml, heuristicClarifyingPrior(heuristics), 'clarifying');
  const hostility = qualityScore(ml, heuristicHostilityPrior(heuristics), 'hostile');
  const dismissiveness = qualityScore(ml, heuristicDismissivePrior(heuristics), 'dismissive');
  const escalation = qualityScore(ml, heuristicEscalationPrior(heuristics), 'escalating');
  const anger = emotionScore(ml, 'anger');
  const trust = emotionScore(ml, 'trust');
  const optimism = emotionScore(ml, 'optimism');
  const targetedNegativity = targetedNegativityScore(ml);
  const sentimentPositive = sentimentPositiveScore(ml);
  const sentimentNegative = sentimentNegativeScore(ml);
  const toxicity = clamp01(abuseScore?.score ?? 0);

  const positiveSignal = clamp01(
    (0.3 * supportiveness)
    + (0.25 * constructiveness)
    + (0.2 * clarifying)
    + (0.1 * trust)
    + (0.1 * optimism)
    + (0.05 * sentimentPositive)
  );
  const negativeSignal = clamp01(
    (0.25 * hostility)
    + (0.2 * dismissiveness)
    + (0.15 * escalation)
    + (0.15 * toxicity)
    + (0.15 * anger)
    + (0.1 * targetedNegativity)
  );

  return {
    positiveSignal,
    negativeSignal,
    supportiveness,
    constructiveness,
    clarifying,
    hostility,
    dismissiveness,
    escalation,
    sentimentPositive,
    sentimentNegative,
    anger,
    trust,
    optimism,
    targetedNegativity,
    toxicity,
  };
}

export function deriveComposerGuidanceState(
  heuristics: SentimentResult,
  ml: ComposerMLSignals,
  abuseScore: AbuseModelResult | null,
): ComposerGuidanceUiState {
  const scores = computeComposerGuidanceScores(heuristics, ml, abuseScore);

  if (heuristics.level === 'alert') return 'alert';
  if (heuristics.hasMentalHealthCrisis) return 'alert';
  if (abuseScore && abuseScore.score >= ABUSE_WARNING_THRESHOLD) return 'warning';
  if (
    scores.negativeSignal >= WARNING_NEGATIVE_THRESHOLD
    || (scores.hostility >= 0.62 && scores.targetedNegativity >= 0.48)
  ) {
    return 'warning';
  }
  if (heuristics.level === 'warn' || scores.negativeSignal >= CAUTION_NEGATIVE_THRESHOLD) {
    return 'caution';
  }
  if (
    heuristics.level === 'positive'
    || (scores.positiveSignal >= POSITIVE_SIGNAL_THRESHOLD && scores.negativeSignal < LOW_NEGATIVE_THRESHOLD)
  ) {
    return 'positive';
  }

  return 'neutral';
}

export function uiStateToLevel(state: ComposerGuidanceUiState): ComposerGuidanceLevel {
  if (state === 'neutral') return 'ok';
  return state;
}

export function normalizeToolsUsed(toolsUsed: string[]): ComposerGuidanceTool[] {
  return toolsUsed.filter((tool): tool is ComposerGuidanceTool => (
    tool === 'heuristic'
    || tool === 'zero-shot-tone'
    || tool === 'abuse-score'
    || tool === 'sentiment-polarity'
    || tool === 'emotion'
    || tool === 'targeted-sentiment'
    || tool === 'quality-score'
    || tool === 'guidance-writer'
  ));
}
