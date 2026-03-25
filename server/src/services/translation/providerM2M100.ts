type M2M100TranslateInput = {
  text: string;
  sourceLang: string;
  targetLang: string;
};

import { ct2WorkerBridge } from './ct2WorkerBridge.js';

type M2M100TranslationOutput = {
  translatedText: string;
  modelVersion: string;
};

const SUPPORTED_M2M100_LANGUAGES = new Set([
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'ja',
  'pt',
  'ru',
]);

function normalizeM2M100Language(language: string, fallback = 'en'): string {
  if (language === 'und') return fallback;
  if (SUPPORTED_M2M100_LANGUAGES.has(language)) return language;
  return fallback;
}

export class M2M100Provider {
  readonly modelVersion = 'facebook/m2m100_418M';

  async translate(input: M2M100TranslateInput): Promise<M2M100TranslationOutput> {
    if (input.sourceLang === input.targetLang) {
      return {
        translatedText: input.text,
        modelVersion: this.modelVersion,
      };
    }

    const modelsRootDir = ct2WorkerBridge.getModelsRootDir();
    const sourceLang = normalizeM2M100Language(input.sourceLang, 'en');
    const targetLang = normalizeM2M100Language(input.targetLang, 'en');
    const translatedText = await ct2WorkerBridge.translate({
      provider: 'm2m100',
      modelDir: `${modelsRootDir}/ct2/m2m100_418M_int8`,
      hfDir: `${modelsRootDir}/hf/m2m100_418M`,
      sourceLang,
      targetLang,
      text: input.text,
    });

    return {
      translatedText,
      modelVersion: this.modelVersion,
    };
  }
}
