export type TranslationPolicy = {
    userLanguage: string;
    autoTranslateFeed: boolean;
    autoTranslateThreads: boolean;
    autoTranslateExplore: boolean;
    localOnlyMode: boolean;
    preferredPairs?: Array<{
        source: string;
        target: string;
    }>;
};
export declare const DEFAULT_TRANSLATION_POLICY: TranslationPolicy;
//# sourceMappingURL=policy.d.ts.map