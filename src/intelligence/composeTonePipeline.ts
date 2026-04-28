import type { AbuseModelLabel, AbuseModelResult } from '../lib/abuseModel';
import type {
  ComposerEmotionResult,
  ComposerQualityResult,
  ComposerSentimentResult,
  ComposerTargetedToneResult,
} from '../lib/composerMl';
import {
  applyToneModelToSentiment,
  analyzeSentiment,
  type AnalyzeOptions,
  type SentimentResult,
  type ToneClassifier,
} from '../lib/sentiment';
import type { ComposerMLSignals } from './composer/classifierContracts';

export type ComposeToneToolKey =
  | 'heuristic'
  | 'zero-shot-tone'
  | 'abuse-score'
  | 'sentiment-polarity'
  | 'emotion'
  | 'targeted-sentiment'
  | 'quality-score';

export interface ComposeToneAnalysis {
  result: SentimentResult;
  toolsUsed: ComposeToneToolKey[];
  abuseScore: AbuseModelResult | null;
  ml: ComposerMLSignals;
}

export interface ComposeToneDependencies {
  classifyTone?: ToneClassifier;
  scoreAbuse?: (text: string) => Promise<AbuseModelResult | null>;
  classifySentiment?: (text: string) => Promise<ComposerSentimentResult>;
  classifyEmotion?: (text: string) => Promise<ComposerEmotionResult>;
  classifyTargetedTone?: (text: string, target: string) => Promise<ComposerTargetedToneResult>;
  classifyQuality?: (text: string) => Promise<ComposerQualityResult>;
}

const ABUSE_WARN_THRESHOLD = 0.72;
const ABUSE_HIGH_SEVERITY_THRESHOLD = 0.42;
const ABUSE_INSULT_THRESHOLD = 0.78;
const ABUSE_TOXIC_THRESHOLD = 0.76;
const ML_MIN_LENGTH = 12;
const MODEL_CONTEXT_SIGNAL_LIMIT = 4;
const MODEL_CONTEXT_SIGNAL_MAX_LENGTH = 120;

let inferenceClientModulePromise: Promise<typeof import('../workers/InferenceClient')> | null = null;

async function getInferenceClientModule() {
  if (!inferenceClientModulePromise) {
    inferenceClientModulePromise = import('../workers/InferenceClient');
  }

  return inferenceClientModulePromise;
}

async function getDefaultToneClassifier(): Promise<ToneClassifier> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text) => inferenceClient.classifyTone(text);
}

async function getDefaultAbuseScorer(): Promise<(text: string) => Promise<AbuseModelResult>> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text) => inferenceClient.scoreAbuse(text);
}

async function getDefaultSentimentClassifier(): Promise<(text: string) => Promise<ComposerSentimentResult>> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text) => inferenceClient.classifySentiment(text);
}

async function getDefaultEmotionClassifier(): Promise<(text: string) => Promise<ComposerEmotionResult>> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text) => inferenceClient.classifyEmotion(text);
}

async function getDefaultTargetedToneClassifier(): Promise<(
  text: string,
  target: string,
) => Promise<ComposerTargetedToneResult>> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text, target) => inferenceClient.classifyTargetedTone(text, target);
}

async function getDefaultQualityClassifier(): Promise<(text: string) => Promise<ComposerQualityResult>> {
  const { inferenceClient } = await getInferenceClientModule();
  return (text) => inferenceClient.classifyComposerQuality(text);
}

function getAbuseSignal(abuse: AbuseModelResult): string {
  const label: AbuseModelLabel = abuse.label;

  if (label === 'threat') {
    return 'This reads as threatening or intimidating language — consider rephrasing before posting.';
  }

  if (label === 'identity_hate') {
    return 'This reads as identity-based abuse — consider rephrasing before posting.';
  }

  if (label === 'severe_toxic') {
    return 'This reads as severely abusive language — consider rephrasing before posting.';
  }

  if (label === 'obscene') {
    return 'This reads as abusive or obscene language — consider rephrasing before posting.';
  }

  if (label === 'insult') {
    return 'This reads as a personal insult — consider rephrasing before posting.';
  }

  return 'This reads as likely abusive or demeaning — consider rephrasing before posting.';
}

function shouldWarnFromAbuse(abuse: AbuseModelResult | null): boolean {
  if (!abuse) return false;
  if (abuse.score >= ABUSE_WARN_THRESHOLD) return true;

  return (
    abuse.scores.threat >= ABUSE_HIGH_SEVERITY_THRESHOLD
    || abuse.scores.identity_hate >= ABUSE_HIGH_SEVERITY_THRESHOLD
    || abuse.scores.severe_toxic >= ABUSE_HIGH_SEVERITY_THRESHOLD
    || abuse.scores.insult >= ABUSE_INSULT_THRESHOLD
    || abuse.scores.toxic >= ABUSE_TOXIC_THRESHOLD
  );
}

function mergeAbuseScore(
  sentiment: SentimentResult,
  abuse: AbuseModelResult | null,
): SentimentResult {
  if (!abuse || !shouldWarnFromAbuse(abuse) || sentiment.level === 'alert') {
    return sentiment;
  }

  return {
    ...sentiment,
    level: 'warn',
    signals: Array.from(new Set([
      ...sentiment.signals,
      getAbuseSignal(abuse),
    ])),
    constructiveSignals: [],
    supportiveReplySignals: [],
  };
}

function toComposerMLSignals(input: {
  sentiment?: ComposerSentimentResult | null;
  emotion?: ComposerEmotionResult | null;
  targetedTone?: ComposerTargetedToneResult | null;
  quality?: ComposerQualityResult | null;
}): ComposerMLSignals {
  const ml: ComposerMLSignals = {};

  if (input.sentiment) {
    ml.sentiment = {
      label: input.sentiment.label,
      confidence: input.sentiment.confidence,
    };
  }

  if (input.emotion) {
    ml.emotions = input.emotion.emotions;
  }

  if (input.targetedTone) {
    ml.targetedTone = {
      label: input.targetedTone.label,
      confidence: input.targetedTone.confidence,
    };
  }

  if (input.quality) {
    ml.conversationQuality = input.quality.scores;
  }

  return ml;
}

function buildContextAwareModelText(text: string, options: AnalyzeOptions): string {
  const contextSignals = (options.contextSignals ?? [])
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MODEL_CONTEXT_SIGNAL_LIMIT)
    .map((value) => value.slice(0, MODEL_CONTEXT_SIGNAL_MAX_LENGTH));

  if (contextSignals.length === 0) {
    return text;
  }

  return [
    text.trim(),
    '',
    'Conversation context:',
    ...contextSignals.map((signal) => `- ${signal}`),
  ].join('\n');
}

export function analyzeComposeToneImmediate(
  text: string,
  options: AnalyzeOptions = {},
): ComposeToneAnalysis {
  return {
    result: analyzeSentiment(text, options),
    toolsUsed: ['heuristic'],
    abuseScore: null,
    ml: {},
  };
}

export async function analyzeComposeTone(
  text: string,
  options: AnalyzeOptions = {},
  dependencies: ComposeToneDependencies = {},
): Promise<ComposeToneAnalysis> {
  const toolsUsed: ComposeToneToolKey[] = ['heuristic'];
  let result = analyzeSentiment(text, options);
  const trimmed = text.trim();
  const contextAwareText = buildContextAwareModelText(trimmed, options);
  const skipNuanceModels = result.level === 'alert' || result.hasMentalHealthCrisis;

  if (!skipNuanceModels && trimmed.length >= 6) {
    try {
      const classifyTone = dependencies.classifyTone ?? await getDefaultToneClassifier();
      const tone = await classifyTone(contextAwareText);
      result = applyToneModelToSentiment(result, trimmed, tone);
      toolsUsed.push('zero-shot-tone');
    } catch {
      result = analyzeSentiment(text, options);
    }
  }

  let abuseScore: AbuseModelResult | null = null;
  if (trimmed.length >= 3) {
    try {
      const scoreAbuse = dependencies.scoreAbuse ?? await getDefaultAbuseScorer();
      abuseScore = await scoreAbuse(trimmed);
      result = mergeAbuseScore(result, abuseScore);
      toolsUsed.push('abuse-score');
    } catch {
      abuseScore = null;
    }
  }

  let sentiment: ComposerSentimentResult | null = null;
  let emotion: ComposerEmotionResult | null = null;
  let targetedTone: ComposerTargetedToneResult | null = null;
  let quality: ComposerQualityResult | null = null;

  if (!skipNuanceModels && trimmed.length >= ML_MIN_LENGTH) {
    try {
      const classifySentiment = dependencies.classifySentiment ?? await getDefaultSentimentClassifier();
      sentiment = await classifySentiment(trimmed);
      toolsUsed.push('sentiment-polarity');
    } catch {
      sentiment = null;
    }

    try {
      const classifyEmotion = dependencies.classifyEmotion ?? await getDefaultEmotionClassifier();
      emotion = await classifyEmotion(trimmed);
      toolsUsed.push('emotion');
    } catch {
      emotion = null;
    }

    if (options.targetText?.trim()) {
      try {
        const classifyTargetedTone = dependencies.classifyTargetedTone ?? await getDefaultTargetedToneClassifier();
        targetedTone = await classifyTargetedTone(trimmed, options.targetText.trim());
        toolsUsed.push('targeted-sentiment');
      } catch {
        targetedTone = null;
      }
    }

    try {
      const classifyQuality = dependencies.classifyQuality ?? await getDefaultQualityClassifier();
      quality = await classifyQuality(contextAwareText);
      toolsUsed.push('quality-score');
    } catch {
      quality = null;
    }
  }

  return {
    result,
    toolsUsed,
    abuseScore,
    ml: toComposerMLSignals({
      sentiment,
      emotion,
      targetedTone,
      quality,
    }),
  };
}
