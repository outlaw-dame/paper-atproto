/**
 * Client-side post sentiment and content analysis.
 *
 * Purpose: surface actionable pre-publish nudges to the author — not to
 * censor or block, but to give a moment of reflection before sending.
 *
 * Three levels:
 *   alert — potentially harmful language (slurs, self-harm encouragement)
 *   warn  — heated/aggressive tone or posts that may land better with context
 *   positive — constructive, supportive, or empathy-first framing
 *   ok    — nothing notable detected
 *
 * Reply-aware: when parentText is supplied (the post being replied to) the
 * analysis also considers the conversation context:
 *   - a heated parent post lowers the threshold for surfacing reply warnings
 *   - signals from the parent that explain the author's emotional state are
 *     surfaced so the author can see why the nudge appeared
 *
 * The deterministic core is entirely local; an optional model-backed wrapper
 * can enrich the result when a tone classifier is provided.
 */
import type { ToneModelResult } from './toneModel.js';
export type SentimentLevel = 'ok' | 'positive' | 'warn' | 'alert';
export interface SentimentResult {
    level: SentimentLevel;
    /** Human-readable nudges to surface in the UI. Empty when level is 'ok'. */
    signals: string[];
    /** Positive-signal architecture: constructive framing detected in draft. */
    constructiveSignals: string[];
    /** Positive-signal architecture: supportive reply language detected in draft. */
    supportiveReplySignals: string[];
    /**
     * When analysing a reply, signals about the parent post that informed the
     * result. Shown to give the author context for why the notice appeared.
     */
    parentSignals: string[];
    /** True when the result was informed by the parent post content. */
    isReplyContext: boolean;
    /** Detected mental health crisis language. If true, show support resources. */
    hasMentalHealthCrisis: boolean;
    /** Specific mental health concern detected (e.g., 'self-harm', 'suicidal', 'severe-depression'). */
    mentalHealthCategory?: 'self-harm' | 'suicidal' | 'severe-depression' | 'hopelessness' | 'isolation';
}
export interface AnalyzeOptions {
    /**
     * The text of the post being replied to. When provided the analysis becomes
     * context-aware: parent heat lowers the reply's warning threshold.
     */
    parentText?: string;
    /** Short reply target string used by targeted sentiment models when available. */
    targetText?: string;
    /** Approximate number of replies on the parent post. */
    parentReplyCount?: number;
    /** Approximate size/depth signal of the related thread. */
    parentThreadCount?: number;
    /** Full thread post texts (including root and major threaded posts). */
    threadTexts?: string[];
    /** Comment/reply texts seen in the thread. */
    commentTexts?: string[];
    /** Aggregate comments/replies count if available. */
    totalCommentCount?: number;
}
export type ToneClassifier = (text: string) => Promise<ToneModelResult>;
export declare function analyzeSentiment(text: string, options?: AnalyzeOptions): SentimentResult;
export declare function analyzeSentimentWithModel(text: string, options?: AnalyzeOptions, classifyTone?: ToneClassifier): Promise<SentimentResult>;
//# sourceMappingURL=sentiment.d.ts.map