import type { AbuseModelResult } from '../lib/abuseModel.js';
import type { ComposerEmotionResult, ComposerQualityResult, ComposerSentimentResult, ComposerTargetedToneResult } from '../lib/composerMl.js';
import type { ToneModelResult } from '../lib/toneModel.js';
declare class InferenceClient {
    private worker;
    private pending;
    private idCounter;
    private readyCallbacks;
    private _status;
    get status(): "error" | "idle" | "loading" | "ready";
    private getWorker;
    private send;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    classifyTone(text: string): Promise<ToneModelResult>;
    scoreAbuse(text: string): Promise<AbuseModelResult>;
    classifySentiment(text: string): Promise<ComposerSentimentResult>;
    classifyEmotion(text: string): Promise<ComposerEmotionResult>;
    classifyTargetedTone(text: string, target: string): Promise<ComposerTargetedToneResult>;
    classifyComposerQuality(text: string): Promise<ComposerQualityResult>;
    getStatus(): Promise<{
        status: string;
        error: string | null;
        captionStatus?: string;
        captionError?: string | null;
        toneStatus?: string;
        toneError?: string | null;
        abuseStatus?: string;
        abuseError?: string | null;
        sentimentStatus?: string;
        sentimentError?: string | null;
        emotionStatus?: string;
        emotionError?: string | null;
        targetedToneStatus?: string;
        targetedToneError?: string | null;
        qualityStatus?: string;
        qualityError?: string | null;
    }>;
    captionImage(imageUrl: string): Promise<string>;
    warmup(): void;
    onReady(): Promise<void>;
    terminate(): void;
}
export declare const inferenceClient: InferenceClient;
export {};
//# sourceMappingURL=InferenceClient.d.ts.map