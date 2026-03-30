import type { TranslationMode } from './types.js';
export type WriterTranslationInput = {
    rootPost: {
        id: string;
        text: string;
        sourceLang?: string;
    };
    selectedComments: Array<{
        id: string;
        text: string;
        sourceLang?: string;
    }>;
    targetLang: string;
    mode: TranslationMode;
};
export type WriterTranslationOutput = {
    rootPost: {
        id: string;
        text: string;
        sourceLang: string;
        translatedText?: string;
    };
    selectedComments: Array<{
        id: string;
        text: string;
        sourceLang: string;
        translatedText?: string;
    }>;
};
export declare function translateWriterInput(input: WriterTranslationInput): Promise<WriterTranslationOutput>;
//# sourceMappingURL=threadTranslation.d.ts.map