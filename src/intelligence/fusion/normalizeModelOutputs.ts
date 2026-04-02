// ─── Fusion — Model Output Normalization ──────────────────────────────────
// Normalizes raw model output scores to a common [0, 1] confidence convention
// before any fusion step.
//
// Each model family has different output conventions (logits, percentages,
// calibrated probabilities, etc.). This layer brings them all to the same
// scale before downstream algorithms compare or fuse them.
//
// Design constraints:
//   • Pure functions — no I/O, no randomness.
//   • Fail-closed: on any error, return zeroed-out safe defaults.
//   • Never log raw model outputs — only structural metadata.
//   • All outputs clamped to [0, 1].

import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Normalized outputs from the sentiment classifier.
 * Input: label + score in whatever the model's native format is.
 */
export interface NormalizedSentiment {
  positive: number;
  negative: number;
  neutral: number;
  /** Confidence that the dominant label is correct [0, 1]. */
  dominantConfidence: number;
  dominantLabel: 'positive' | 'negative' | 'neutral';
}

/**
 * Normalized outputs from the emotion classifier.
 */
export interface NormalizedEmotion {
  joy: number;
  anger: number;
  sadness: number;
  fear: number;
  surprise: number;
  disgust: number;
  /** Dominant emotion label. */
  dominantEmotion: string;
  /** Confidence in dominant emotion [0, 1]. */
  dominantConfidence: number;
}

/**
 * Normalized outputs from the tone classifier.
 */
export interface NormalizedTone {
  constructive: number;
  hostile: number;
  neutral: number;
  dominantLabel: 'constructive' | 'hostile' | 'neutral';
  dominantConfidence: number;
}

/**
 * Normalized outputs from the targeted-tone classifier.
 */
export interface NormalizedTargetedTone {
  /** How targeted/personalized the hostility is [0, 1]. */
  targetedHostility: number;
  /** How constructive the reply is toward the target [0, 1]. */
  targetedConstructive: number;
  dominantLabel: 'targeted_hostile' | 'targeted_constructive' | 'neutral';
  dominantConfidence: number;
}

/**
 * Normalized outputs from the toxicity/abuse classifier.
 */
export interface NormalizedAbuse {
  toxicity: number;
  severe: number;
  obscene: number;
  threat: number;
  /** Overall abuse confidence [0, 1]. */
  abuseScore: number;
}

/**
 * Normalized outputs from the quality/usefulness classifier.
 */
export interface NormalizedQuality {
  constructiveScore: number;
  coherenceScore: number;
  specificity: number;
  overallQuality: number;
}

// ─── Normalization helpers ────────────────────────────────────────────────

/**
 * Normalize a raw probability array (sum ≈ 1 or not) to [0, 1] per entry.
 * If the sum is 0 or invalid, returns equal weights.
 */
export function normalizeProbabilities(raw: number[]): number[] {
  if (!raw?.length) return [];
  try {
    const clamped = raw.map(v => clamp01(Number.isFinite(v) ? v : 0));
    const sum = clamped.reduce((s, v) => s + v, 0);
    if (sum <= 0) {
      const equal = 1 / clamped.length;
      return clamped.map(() => equal);
    }
    return clamped.map(v => clamp01(v / sum));
  } catch {
    return raw.map(() => 0);
  }
}

/**
 * Convert a logit score to a probability via sigmoid.
 */
export function sigmoid(logit: number): number {
  try {
    return clamp01(1 / (1 + Math.exp(-logit)));
  } catch {
    return 0.5;
  }
}

/**
 * Softmax normalization over an array of raw scores.
 */
export function softmax(scores: number[]): number[] {
  if (!scores?.length) return [];
  try {
    const max = Math.max(...scores);
    const exps = scores.map(s => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return sum > 0 ? exps.map(e => clamp01(e / sum)) : scores.map(() => 1 / scores.length);
  } catch {
    return scores.map(() => 0);
  }
}

// ─── Sentiment normalization ──────────────────────────────────────────────

type RawLabelScore = { label: string; score: number };

/**
 * Normalize raw sentiment classifier output (label + score pairs).
 * Handles: POSITIVE/NEGATIVE/NEUTRAL labels in any case.
 */
export function normalizeSentiment(
  raw: RawLabelScore | RawLabelScore[] | null | undefined,
): NormalizedSentiment {
  const zero: NormalizedSentiment = {
    positive: 0,
    negative: 0,
    neutral: 0,
    dominantConfidence: 0,
    dominantLabel: 'neutral',
  };

  if (!raw) return zero;

  try {
    const entries = Array.isArray(raw) ? raw : [raw];
    const buckets: Record<'positive' | 'negative' | 'neutral', number> = {
      positive: 0, negative: 0, neutral: 0,
    };

    for (const entry of entries) {
      const label = String(entry.label ?? '').toLowerCase();
      const score = clamp01(Number.isFinite(entry.score) ? entry.score : 0);
      if (label.includes('pos')) buckets.positive = Math.max(buckets.positive, score);
      else if (label.includes('neg')) buckets.negative = Math.max(buckets.negative, score);
      else buckets.neutral = Math.max(buckets.neutral, score);
    }

    // Re-normalize so they sum to 1
    const total = buckets.positive + buckets.negative + buckets.neutral;
    if (total > 0) {
      buckets.positive = clamp01(buckets.positive / total);
      buckets.negative = clamp01(buckets.negative / total);
      buckets.neutral = clamp01(buckets.neutral / total);
    } else {
      buckets.neutral = 1;
    }

    let dominantLabel: NormalizedSentiment['dominantLabel'] = 'neutral';
    let dominantConfidence = buckets.neutral;
    if (buckets.positive >= buckets.negative && buckets.positive >= buckets.neutral) {
      dominantLabel = 'positive'; dominantConfidence = buckets.positive;
    } else if (buckets.negative >= buckets.positive && buckets.negative >= buckets.neutral) {
      dominantLabel = 'negative'; dominantConfidence = buckets.negative;
    }

    return { ...buckets, dominantLabel, dominantConfidence: clamp01(dominantConfidence) };
  } catch {
    return zero;
  }
}

// ─── Tone normalization ───────────────────────────────────────────────────

/**
 * Normalize raw tone classifier output.
 * Expects label + score pairs with labels like 'constructive', 'hostile', 'neutral'.
 */
export function normalizeTone(
  raw: RawLabelScore | RawLabelScore[] | null | undefined,
): NormalizedTone {
  const zero: NormalizedTone = {
    constructive: 0,
    hostile: 0,
    neutral: 1,
    dominantLabel: 'neutral',
    dominantConfidence: 0,
  };

  if (!raw) return zero;

  try {
    const entries = Array.isArray(raw) ? raw : [raw];
    const buckets: Record<'constructive' | 'hostile' | 'neutral', number> = {
      constructive: 0, hostile: 0, neutral: 0,
    };

    for (const entry of entries) {
      const label = String(entry.label ?? '').toLowerCase();
      const score = clamp01(Number.isFinite(entry.score) ? entry.score : 0);
      if (label.includes('construct')) buckets.constructive = Math.max(buckets.constructive, score);
      else if (label.includes('hostile') || label.includes('toxic') || label.includes('negative')) {
        buckets.hostile = Math.max(buckets.hostile, score);
      } else {
        buckets.neutral = Math.max(buckets.neutral, score);
      }
    }

    const total = buckets.constructive + buckets.hostile + buckets.neutral;
    if (total > 0) {
      buckets.constructive = clamp01(buckets.constructive / total);
      buckets.hostile = clamp01(buckets.hostile / total);
      buckets.neutral = clamp01(buckets.neutral / total);
    } else {
      buckets.neutral = 1;
    }

    let dominantLabel: NormalizedTone['dominantLabel'] = 'neutral';
    let dominantConfidence = buckets.neutral;
    if (buckets.constructive >= buckets.hostile && buckets.constructive >= buckets.neutral) {
      dominantLabel = 'constructive'; dominantConfidence = buckets.constructive;
    } else if (buckets.hostile >= buckets.constructive && buckets.hostile >= buckets.neutral) {
      dominantLabel = 'hostile'; dominantConfidence = buckets.hostile;
    }

    return { ...buckets, dominantLabel, dominantConfidence: clamp01(dominantConfidence) };
  } catch {
    return zero;
  }
}

// ─── Abuse normalization ──────────────────────────────────────────────────

/**
 * Normalize a raw abuse/toxicity score object.
 * Input may be a simple {score: number} or a structured multi-attribute object.
 */
export function normalizeAbuse(
  raw: { score?: number; toxicity?: number; severe_toxicity?: number; obscene?: number; threat?: number } | null | undefined,
): NormalizedAbuse {
  const zero: NormalizedAbuse = { toxicity: 0, severe: 0, obscene: 0, threat: 0, abuseScore: 0 };
  if (!raw) return zero;

  try {
    const toxicity = clamp01(Number.isFinite(raw.toxicity) ? raw.toxicity! : (Number.isFinite(raw.score) ? raw.score! : 0));
    const severe = clamp01(Number.isFinite(raw.severe_toxicity) ? raw.severe_toxicity! : 0);
    const obscene = clamp01(Number.isFinite(raw.obscene) ? raw.obscene! : 0);
    const threat = clamp01(Number.isFinite(raw.threat) ? raw.threat! : 0);

    const abuseScore = clamp01(
      toxicity * 0.50 + severe * 0.25 + obscene * 0.15 + threat * 0.10,
    );

    return { toxicity, severe, obscene, threat, abuseScore };
  } catch {
    return zero;
  }
}

// ─── Quality normalization ────────────────────────────────────────────────

/**
 * Normalize a raw quality/usefulness classifier output.
 */
export function normalizeQuality(
  raw: { score?: number; constructive?: number; coherence?: number; specificity?: number } | null | undefined,
): NormalizedQuality {
  const zero: NormalizedQuality = {
    constructiveScore: 0,
    coherenceScore: 0,
    specificity: 0,
    overallQuality: 0,
  };
  if (!raw) return zero;

  try {
    const constructiveScore = clamp01(Number.isFinite(raw.constructive) ? raw.constructive! : (Number.isFinite(raw.score) ? raw.score! : 0));
    const coherenceScore = clamp01(Number.isFinite(raw.coherence) ? raw.coherence! : constructiveScore * 0.8);
    const specificity = clamp01(Number.isFinite(raw.specificity) ? raw.specificity! : 0);

    const overallQuality = clamp01(
      constructiveScore * 0.50 + coherenceScore * 0.35 + specificity * 0.15,
    );

    return { constructiveScore, coherenceScore, specificity, overallQuality };
  } catch {
    return zero;
  }
}
