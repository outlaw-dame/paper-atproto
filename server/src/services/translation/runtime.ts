import {
  BERGAMOT_PAIRS,
  HOT_PAIRS,
  type TranslationMode,
  type TranslationProvider,
  type TranslationResult,
} from './types.js';
import { chooseTranslationProvider } from './router.js';
import { M2M100Provider } from './providerM2M100.js';
import { MarianProvider } from './providerMarian.js';
import { BergamotBridgeProvider } from './providerBergamotBridge.js';

const m2m100 = new M2M100Provider();
const marian = new MarianProvider();
const bergamot = new BergamotBridgeProvider();

function pairKey(sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}`;
}

export async function translateWithRouter(input: {
  id: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  mode: TranslationMode;
  localOnlyMode: boolean;
}): Promise<TranslationResult> {
  const key = pairKey(input.sourceLang, input.targetLang);
  const providerName: TranslationProvider = chooseTranslationProvider({
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    mode: input.mode,
    localOnlyMode: input.localOnlyMode,
    supportedByBergamot: BERGAMOT_PAIRS.has(key),
    hotPair: HOT_PAIRS.has(key),
  });

  let translatedText = input.sourceText;
  let modelVersion = 'unknown';
  let qualityTier: TranslationResult['qualityTier'] = 'default';

  if (providerName === 'bergamot') {
    translatedText = await bergamot.translate({
      text: input.sourceText,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
    });
    modelVersion = bergamot.modelVersion;
    qualityTier = 'local';
  } else if (providerName === 'marian') {
    try {
      const output = await marian.translate({
        text: input.sourceText,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
      });
      translatedText = output.translatedText;
      modelVersion = output.modelVersion;
      qualityTier = 'optimized';
    } catch {
      const output = await m2m100.translate({
        text: input.sourceText,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
      });
      translatedText = output.translatedText;
      modelVersion = output.modelVersion;
      qualityTier = 'default';
    }
  } else {
    const output = await m2m100.translate({
      text: input.sourceText,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
    });
    translatedText = output.translatedText;
    modelVersion = output.modelVersion;
    qualityTier = 'default';
  }

  return {
    id: input.id,
    translatedText,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    provider: providerName,
    cached: false,
    modelVersion,
    qualityTier,
  };
}
