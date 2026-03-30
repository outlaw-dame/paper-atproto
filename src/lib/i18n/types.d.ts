export type TranslationProvider = 'm2m100' | 'marian' | 'bergamot' | 'nllb_experimental';
export type TranslationMode = 'server_default' | 'server_optimized' | 'local_private';
export type TranslationVisibility = 'inline_post' | 'thread_reply' | 'story_synopsis' | 'entity_snippet' | 'writer_input';
export type TranslationRequest = {
    id: string;
    sourceText: string;
    sourceLang?: string;
    targetLang: string;
    visibility: TranslationVisibility;
    mode: TranslationMode;
    allowServer: boolean;
    allowLocal: boolean;
};
export type TranslationResult = {
    id: string;
    translatedText: string;
    sourceLang: string;
    targetLang: string;
    provider: TranslationProvider;
    cached: boolean;
    modelVersion: string;
    qualityTier: 'default' | 'optimized' | 'local';
};
export type LanguageDetectionResult = {
    language: string;
    confidence: number;
};
export type InlineTranslateRequest = {
    id: string;
    sourceText: string;
    sourceLang?: string;
    targetLang: string;
    mode: TranslationMode;
};
export type InlineTranslateResponse = {
    ok: true;
    result: TranslationResult;
};
export type BatchTranslateRequest = {
    items: Array<{
        id: string;
        sourceText: string;
        sourceLang?: string;
    }>;
    targetLang: string;
    mode: TranslationMode;
    visibility: TranslationVisibility;
};
export type BatchTranslateResponse = {
    ok: true;
    results: TranslationResult[];
};
export type DetectLanguageRequest = {
    id: string;
    text: string;
};
export type DetectLanguageResponse = {
    ok: true;
    result: LanguageDetectionResult;
};
//# sourceMappingURL=types.d.ts.map