export type TranslationPolicy = {
  userLanguage: string;
  autoTranslateFeed: boolean;
  autoTranslateThreads: boolean;
  autoTranslateExplore: boolean;
  localOnlyMode: boolean;
  preferredPairs?: Array<{ source: string; target: string }>;
};

export const DEFAULT_TRANSLATION_POLICY: TranslationPolicy = {
  userLanguage: 'en',
  autoTranslateFeed: false,
  autoTranslateThreads: false,
  autoTranslateExplore: false,
  localOnlyMode: false,
};
