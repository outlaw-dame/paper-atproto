import type { TranslationResult } from './types.js';
export type TranslationCacheKey = {
    id: string;
    sourceLang: string;
    targetLang: string;
    modelVersion: string;
};
export declare function getCachedTranslation(key: TranslationCacheKey): TranslationResult | null;
export declare function setCachedTranslation(key: TranslationCacheKey, result: TranslationResult): void;
export declare function clearTranslationCacheById(id: string): void;
//# sourceMappingURL=cache.d.ts.map