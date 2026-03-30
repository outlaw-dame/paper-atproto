import type { BatchTranslateRequest, DetectLanguageRequest, InlineTranslateRequest, LanguageDetectionResult, TranslationResult } from './types.js';
export type TranslationHttpClientConfig = {
    baseUrl: string;
    timeoutMs: number;
};
export declare class TranslationHttpClient {
    private readonly config;
    constructor(config: TranslationHttpClientConfig);
    private postJson;
    translateInline(req: InlineTranslateRequest): Promise<TranslationResult>;
    translateBatch(req: BatchTranslateRequest): Promise<TranslationResult[]>;
    detectLanguage(req: DetectLanguageRequest): Promise<LanguageDetectionResult>;
}
export declare const translationClient: TranslationHttpClient;
//# sourceMappingURL=client.d.ts.map