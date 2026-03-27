import type {
  ComposerEmotionLabel,
  ComposerQualityScores,
  ComposerSentimentLabel,
  ComposerTargetedToneLabel,
} from '../../lib/composerMl.js';

export interface ComposerSentimentSignal {
  label: ComposerSentimentLabel;
  confidence: number;
}

export interface ComposerEmotionSignal {
  label: ComposerEmotionLabel;
  score: number;
}

export interface ComposerTargetedToneSignal {
  label: ComposerTargetedToneLabel;
  confidence: number;
}

export type ComposerConversationQualitySignals = ComposerQualityScores;

export interface ComposerMLSignals {
  sentiment?: ComposerSentimentSignal;
  emotions?: ComposerEmotionSignal[];
  targetedTone?: ComposerTargetedToneSignal;
  conversationQuality?: ComposerConversationQualitySignals;
}
