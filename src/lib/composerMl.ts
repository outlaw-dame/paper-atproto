export const COMPOSER_SENTIMENT_LABELS = ['negative', 'neutral', 'positive'] as const;
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

export const COMPOSER_EMOTION_LABELS = [
  'anger',
  'anticipation',
  'disgust',
  'fear',
  'joy',
  'love',
  'optimism',
  'pessimism',
  'sadness',
  'surprise',
  'trust',
] as const;
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

export const COMPOSER_TARGETED_TONE_LABELS = [
  'strongly_negative',
  'negative',
  'negative_or_neutral',
  'positive',
  'strongly_positive',
] as const;
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

export const COMPOSER_QUALITY_LABELS = [
  'constructive',
  'supportive',
  'clarifying',
  'dismissive',
  'hostile',
  'escalating',
] as const;
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
