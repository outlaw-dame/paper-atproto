// ─── Multimodal — Media Centrality ────────────────────────────────────────
// Classifies how central a media item is to the thread's primary claim.
//
// Centrality levels:
//   'core'       — the media IS the claim (e.g. the screenshot of a policy)
//   'supportive' — the media corroborates the text claim
//   'incidental' — the media illustrates but is not load-bearing
//   'unknown'    — not enough signal to classify
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.

import type { MediaKind } from './mediaClassifier';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export type MediaCentralityLevel = 'core' | 'supportive' | 'incidental' | 'unknown';

export interface MediaCentralityResult {
  level: MediaCentralityLevel;
  /** Numeric centrality [0, 1] — higher = more central. */
  score: number;
  /** Confidence in this classification [0, 1]. */
  confidence: number;
}

// ─── Patterns ─────────────────────────────────────────────────────────────

// Strong signals that the media IS the claim
const CORE_PATTERNS = [
  /\b(?:this (?:screenshot|image|document|chart|photo|picture) (?:shows?|proves?|demonstrates?|confirms?))\b/i,
  /\b(?:here'?s (?:the|a) (?:proof|evidence|screenshot|document|image|photo))\b/i,
  /\b(?:as (?:shown|seen|visible) (?:in|from|via) (?:the|this) (?:image|photo|screenshot|document|chart))\b/i,
  /\b(?:the (?:image|photo|screenshot|document|chart) (?:shows?|proves?|confirms?|demonstrates?))\b/i,
  /\b(?:photographic|documented|documented evidence|visual evidence|screenshot evidence)\b/i,
];

// Medium signals — media corroborates but text could stand alone
const SUPPORTIVE_PATTERNS = [
  /\b(?:for (?:reference|example|context|illustration)|illustrates?|demonstrates?|accompanies?|relevant (?:image|chart|graph|document))\b/i,
  /\b(?:chart|graph|graph) (?:below|above|attached|included|shown)\b/i,
  /\b(?:the (?:attached|included|following) (?:image|photo|document|chart))\b/i,
];

// ─── classifyMediaCentrality ───────────────────────────────────────────────

/**
 * Classify media centrality from the media's pre-classification and post context.
 *
 * @param kind         — pre-classified media kind
 * @param isClaimCarrier — from mediaClassifier.classifyMedia()
 * @param isTextHeavy  — from mediaClassifier.classifyMedia()
 * @param nearbyText   — surrounding post text
 * @param rootTextShort — whether the root post has < 80 chars (media likely carries the claim)
 * @param modelCentrality — optional centrality from the vision model [0, 1]
 *
 * Never throws.
 */
export function classifyMediaCentrality(
  kind: MediaKind,
  isClaimCarrier: boolean,
  isTextHeavy: boolean,
  nearbyText: string,
  rootTextShort: boolean,
  modelCentrality?: number,
): MediaCentralityResult {
  const unknown: MediaCentralityResult = { level: 'unknown', score: 0, confidence: 0 };

  try {
    const text = (nearbyText ?? '').slice(0, 500);

    // Model centrality is the strongest signal if provided
    if (Number.isFinite(modelCentrality)) {
      const mc = clamp01(modelCentrality!);
      if (mc >= 0.75) return { level: 'core', score: mc, confidence: 0.85 };
      if (mc >= 0.45) return { level: 'supportive', score: mc, confidence: 0.75 };
      if (mc >= 0.20) return { level: 'incidental', score: mc, confidence: 0.65 };
      return { level: 'incidental', score: mc, confidence: 0.60 };
    }

    // Heuristic classification
    const coreMatch = CORE_PATTERNS.some(p => p.test(text));
    const supportiveMatch = SUPPORTIVE_PATTERNS.some(p => p.test(text));

    // Core signals
    if (coreMatch || (isClaimCarrier && rootTextShort)) {
      const score = clamp01(
        0.70 +
        (coreMatch ? 0.15 : 0) +
        (isTextHeavy ? 0.10 : 0) +
        (rootTextShort ? 0.05 : 0),
      );
      return { level: 'core', score, confidence: 0.65 };
    }

    // Screenshots and documents default toward "core" even without text signals
    if ((kind === 'screenshot' || kind === 'document') && isClaimCarrier) {
      return { level: 'core', score: 0.65, confidence: 0.55 };
    }

    // Supportive signals
    if (supportiveMatch || kind === 'chart') {
      const score = clamp01(
        0.45 +
        (supportiveMatch ? 0.10 : 0) +
        (isClaimCarrier ? 0.10 : 0),
      );
      return { level: 'supportive', score, confidence: 0.55 };
    }

    // Default: incidental (photo, meme, etc.)
    const score = kind === 'photo' ? 0.25 : 0.15;
    return { level: 'incidental', score, confidence: 0.40 };
  } catch {
    return unknown;
  }
}
