export type TranslationProvider =
  | 'm2m100'
  | 'marian'
  | 'bergamot'
  | 'nllb_experimental';

export type TranslationMode =
  | 'server_default'
  | 'server_optimized'
  | 'local_private';

export type TranslationVisibility =
  | 'inline_post'
  | 'thread_reply'
  | 'story_synopsis'
  | 'entity_snippet'
  | 'writer_input';

export type LanguageDetectionResult = {
  language: string;
  confidence: number;
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

export type InlineTranslateRequest = {
  id: string;
  sourceText: string;
  sourceLang?: string;
  targetLang: string;
  mode: TranslationMode;
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

export type DetectLanguageRequest = {
  id: string;
  text: string;
};

export const HOT_PAIRS = new Set([
  'en:es',
  'es:en',
  'en:fr',
  'fr:en',
  'en:de',
  'de:en',
  'en:pt',
  'pt:en',
  'en:ja',
  'ja:en',
]);

export const BERGAMOT_PAIRS = new Set([
  'en:es',
  'es:en',
  'en:fr',
  'fr:en',
  'en:de',
  'de:en',
]);
