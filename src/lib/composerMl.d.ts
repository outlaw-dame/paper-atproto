export declare const COMPOSER_SENTIMENT_LABELS: readonly ["negative", "neutral", "positive"];
export type ComposerSentimentLabel = typeof COMPOSER_SENTIMENT_LABELS[number];
export interface ComposerSentimentScores {
    negative: number;
    neutral: number;
    positive: number;
}
export interface ComposerSentimentResult {
    model: string;
    label: ComposerSentimentLabel;
    confidence: number;
    scores: ComposerSentimentScores;
}
export declare const COMPOSER_EMOTION_LABELS: readonly ["anger", "anticipation", "disgust", "fear", "joy", "love", "optimism", "pessimism", "sadness", "surprise", "trust"];
export type ComposerEmotionLabel = typeof COMPOSER_EMOTION_LABELS[number];
export interface ComposerEmotionScores {
    anger: number;
    anticipation: number;
    disgust: number;
    fear: number;
    joy: number;
    love: number;
    optimism: number;
    pessimism: number;
    sadness: number;
    surprise: number;
    trust: number;
}
export interface ComposerEmotionResult {
    model: string;
    emotions: Array<{
        label: ComposerEmotionLabel;
        score: number;
    }>;
    scores: ComposerEmotionScores;
}
export declare const COMPOSER_TARGETED_TONE_LABELS: readonly ["strongly_negative", "negative", "negative_or_neutral", "positive", "strongly_positive"];
export type ComposerTargetedToneLabel = typeof COMPOSER_TARGETED_TONE_LABELS[number];
export interface ComposerTargetedToneScores {
    strongly_negative: number;
    negative: number;
    negative_or_neutral: number;
    positive: number;
    strongly_positive: number;
}
export interface ComposerTargetedToneResult {
    model: string;
    target: string;
    label: ComposerTargetedToneLabel;
    confidence: number;
    scores: ComposerTargetedToneScores;
}
export declare const COMPOSER_QUALITY_LABELS: readonly ["constructive", "supportive", "clarifying", "dismissive", "hostile", "escalating"];
export type ComposerQualityLabel = typeof COMPOSER_QUALITY_LABELS[number];
export interface ComposerQualityScores {
    constructive: number;
    supportive: number;
    clarifying: number;
    dismissive: number;
    hostile: number;
    escalating: number;
}
export interface ComposerQualityResult {
    model: string;
    provider: string;
    label: ComposerQualityLabel;
    confidence: number;
    scores: ComposerQualityScores;
}
//# sourceMappingURL=composerMl.d.ts.map