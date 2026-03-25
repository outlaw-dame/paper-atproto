type MarianTranslateInput = {
  text: string;
  sourceLang: string;
  targetLang: string;
};

import { ct2WorkerBridge } from './ct2WorkerBridge.js';

type MarianTranslationOutput = {
  translatedText: string;
  modelVersion: string;
};

type MarianModelConfig = {
  modelShortName: string;
  sourceLang: string;
  targetLang: string;
  targetPrefix?: string;
};

function normalizeMarianLanguage(language: string): string {
  if (language === 'ja') return 'jap';
  if (language === 'pt-br' || language === 'pt_pt') return 'pt';
  return language;
}

function resolveMarianModel(sourceLang: string, targetLang: string): MarianModelConfig {
  const normalizedSource = normalizeMarianLanguage(sourceLang);
  const normalizedTarget = normalizeMarianLanguage(targetLang);
  const pairKey = `${normalizedSource}:${normalizedTarget}`;

  switch (pairKey) {
    case 'en:es':
      return { modelShortName: 'opus-mt-en-es', sourceLang: 'en', targetLang: 'es' };
    case 'es:en':
      return { modelShortName: 'opus-mt-es-en', sourceLang: 'es', targetLang: 'en' };
    case 'en:fr':
      return { modelShortName: 'opus-mt-en-fr', sourceLang: 'en', targetLang: 'fr' };
    case 'fr:en':
      return { modelShortName: 'opus-mt-fr-en', sourceLang: 'fr', targetLang: 'en' };
    case 'en:de':
      return { modelShortName: 'opus-mt-en-de', sourceLang: 'en', targetLang: 'de' };
    case 'de:en':
      return { modelShortName: 'opus-mt-de-en', sourceLang: 'de', targetLang: 'en' };
    case 'en:pt':
      return {
        modelShortName: 'opus-mt-en-ROMANCE',
        sourceLang: 'en',
        targetLang: 'pt',
        targetPrefix: 'pt',
      };
    case 'pt:en':
      return { modelShortName: 'opus-mt-ROMANCE-en', sourceLang: 'pt', targetLang: 'en' };
    case 'en:jap':
      return { modelShortName: 'opus-mt-en-jap', sourceLang: 'en', targetLang: 'jap' };
    case 'jap:en':
      return { modelShortName: 'opus-mt-jap-en', sourceLang: 'jap', targetLang: 'en' };
    default:
      throw new Error(`Unsupported Marian pair: ${sourceLang}->${targetLang}`);
  }
}

export class MarianProvider {
  readonly modelVersion = 'Helsinki-NLP/opus-mt';

  async translate(input: MarianTranslateInput): Promise<MarianTranslationOutput> {
    if (input.sourceLang === input.targetLang) {
      return {
        translatedText: input.text,
        modelVersion: this.modelVersion,
      };
    }

    const model = resolveMarianModel(input.sourceLang, input.targetLang);
    const modelsRootDir = ct2WorkerBridge.getModelsRootDir();
    const translatedText = await ct2WorkerBridge.translate({
      provider: 'marian',
      modelDir: `${modelsRootDir}/ct2/${model.modelShortName}_int8`,
      hfDir: `${modelsRootDir}/hf/${model.modelShortName}`,
      sourceLang: model.sourceLang,
      targetLang: model.targetLang,
      text: input.text,
      ...(model.targetPrefix ? { targetPrefix: model.targetPrefix } : {}),
    });

    return {
      translatedText,
      modelVersion: `Helsinki-NLP/${model.modelShortName}`,
    };
  }
}
