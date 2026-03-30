import type { AbuseModelResult } from '../lib/abuseModel.js';
import type { ComposerEmotionResult, ComposerQualityResult, ComposerSentimentResult, ComposerTargetedToneResult } from '../lib/composerMl.js';
import { type AnalyzeOptions, type SentimentResult, type ToneClassifier } from '../lib/sentiment.js';
import type { ComposerMLSignals } from './composer/classifierContracts.js';
export type ComposeToneToolKey = 'heuristic' | 'zero-shot-tone' | 'abuse-score' | 'sentiment-polarity' | 'emotion' | 'targeted-sentiment' | 'quality-score';
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
export declare function analyzeComposeToneImmediate(text: string, options?: AnalyzeOptions): ComposeToneAnalysis;
export declare function analyzeComposeTone(text: string, options?: AnalyzeOptions, dependencies?: ComposeToneDependencies): Promise<ComposeToneAnalysis>;
//# sourceMappingURL=composeTonePipeline.d.ts.map