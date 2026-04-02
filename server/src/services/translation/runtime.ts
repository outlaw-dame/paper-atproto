import {
  BERGAMOT_PAIRS,
  HOT_PAIRS,
  type BatchTranslateRequest,
  type TranslationMode,
  type TranslationProvider,
  type TranslationResult,
} from './types.js';
import { prepareHashtagsForTranslation, restoreTranslatedHashtags } from './hashtags.js';
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

type RuntimeProfile = NonNullable<TranslationResult['runtimeProfile']>;

function runtimeProfileForMode(mode: TranslationMode): RuntimeProfile {
  if (mode === 'local_private') return 'privacy';
  if (mode === 'server_optimized') return 'quality';
  return 'latency';
}

export async function translateWithRouter(input: {
  id: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  mode: TranslationMode;
  localOnlyMode: boolean;
}): Promise<TranslationResult> {
  const preparedInput = prepareHashtagsForTranslation(input.sourceText);
  const key = pairKey(input.sourceLang, input.targetLang);
  const providerName: TranslationProvider = chooseTranslationProvider({
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    mode: input.mode,
    localOnlyMode: input.localOnlyMode,
    supportedByBergamot: BERGAMOT_PAIRS.has(key),
    hotPair: HOT_PAIRS.has(key),
  });

  let translatedText = preparedInput.text;
  let modelVersion = 'unknown';
  let qualityTier: TranslationResult['qualityTier'] = 'default';

  if (providerName === 'bergamot') {
    translatedText = await bergamot.translate({
      text: preparedInput.text,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
    });
    modelVersion = bergamot.modelVersion;
    qualityTier = 'local';
  } else if (providerName === 'marian') {
    try {
      const output = await marian.translate({
        text: preparedInput.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
      });
      translatedText = output.translatedText;
      modelVersion = output.modelVersion;
      qualityTier = 'optimized';
    } catch {
      const output = await m2m100.translate({
        text: preparedInput.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
      });
      translatedText = output.translatedText;
      modelVersion = output.modelVersion;
      qualityTier = 'default';
    }
  } else {
    const output = await m2m100.translate({
      text: preparedInput.text,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
    });
    translatedText = output.translatedText;
    modelVersion = output.modelVersion;
    qualityTier = 'default';
  }

  translatedText = restoreTranslatedHashtags(translatedText, preparedInput.tokens);

  return {
    id: input.id,
    translatedText,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    provider: providerName,
    cached: false,
    modelVersion,
    qualityTier,
    runtimeProfile: runtimeProfileForMode(input.mode),
  };
}

type BatchTranslateItemInput = BatchTranslateRequest['items'][number] & {
  mode: TranslationMode;
};

export async function translateBatchWithRouter(input: {
  items: BatchTranslateItemInput[];
  targetLang: string;
}): Promise<TranslationResult[]> {
  if (input.items.length === 0) return [];

  const withProvider = input.items.map((item, index) => {
    const key = pairKey(item.sourceLang ?? 'und', input.targetLang);
    const provider = chooseTranslationProvider({
      sourceLang: item.sourceLang ?? 'und',
      targetLang: input.targetLang,
      mode: item.mode,
      localOnlyMode: item.mode === 'local_private',
      supportedByBergamot: BERGAMOT_PAIRS.has(key),
      hotPair: HOT_PAIRS.has(key),
    });

    return {
      index,
      provider,
      sourceLang: item.sourceLang ?? 'und',
      item,
    };
  });

  const results: TranslationResult[] = Array.from({ length: input.items.length }, () => ({
    id: '',
    translatedText: '',
    sourceLang: 'und',
    targetLang: input.targetLang,
    provider: 'm2m100',
    cached: false,
    modelVersion: 'fallback:identity',
    qualityTier: 'default',
    runtimeProfile: 'latency',
  }));

  const grouped = new Map<string, Array<typeof withProvider[number]>>();
  for (const entry of withProvider) {
    const groupKey = `${entry.provider}::${entry.sourceLang}::${entry.item.mode}`;
    const group = grouped.get(groupKey);
    if (group) group.push(entry);
    else grouped.set(groupKey, [entry]);
  }

  await Promise.all([...grouped.values()].map(async (group) => {
    const first = group[0]!;
    const sourceLang = first.sourceLang;
    const mode = first.item.mode;
    const texts = group.map((entry) => prepareHashtagsForTranslation(entry.item.sourceText));
    const textValues = texts.map((entry) => entry.text);

    if (first.provider === 'bergamot') {
      const translatedTexts = await Promise.all(textValues.map((text) => bergamot.translate({
        text,
        sourceLang,
        targetLang: input.targetLang,
      })));

      group.forEach((entry, idx) => {
        const translatedText = restoreTranslatedHashtags(translatedTexts[idx] ?? textValues[idx] ?? '', texts[idx]?.tokens ?? []);
        results[entry.index] = {
          id: entry.item.id,
          translatedText,
          sourceLang,
          targetLang: input.targetLang,
          provider: 'bergamot',
          cached: false,
          modelVersion: bergamot.modelVersion,
          qualityTier: 'local',
          runtimeProfile: runtimeProfileForMode(mode),
        };
      });
      return;
    }

    if (first.provider === 'marian') {
      let translatedBatch: Array<{ translatedText: string; modelVersion: string }>;
      let provider: TranslationProvider = 'marian';
      let qualityTier: TranslationResult['qualityTier'] = 'optimized';

      try {
        translatedBatch = await marian.translateBatch({
          texts: textValues,
          sourceLang,
          targetLang: input.targetLang,
        });
      } catch {
        translatedBatch = await m2m100.translateBatch({
          texts: textValues,
          sourceLang,
          targetLang: input.targetLang,
        });
        provider = 'm2m100';
        qualityTier = 'default';
      }

      group.forEach((entry, idx) => {
        const output = translatedBatch[idx];
        const translatedText = restoreTranslatedHashtags(output?.translatedText ?? textValues[idx] ?? '', texts[idx]?.tokens ?? []);
        results[entry.index] = {
          id: entry.item.id,
          translatedText,
          sourceLang,
          targetLang: input.targetLang,
          provider,
          cached: false,
          modelVersion: output?.modelVersion ?? 'unknown',
          qualityTier,
          runtimeProfile: runtimeProfileForMode(mode),
        };
      });
      return;
    }

    const translatedBatch = await m2m100.translateBatch({
      texts: textValues,
      sourceLang,
      targetLang: input.targetLang,
    });

    group.forEach((entry, idx) => {
      const output = translatedBatch[idx];
      const translatedText = restoreTranslatedHashtags(output?.translatedText ?? textValues[idx] ?? '', texts[idx]?.tokens ?? []);
      results[entry.index] = {
        id: entry.item.id,
        translatedText,
        sourceLang,
        targetLang: input.targetLang,
        provider: 'm2m100',
        cached: false,
        modelVersion: output?.modelVersion ?? 'unknown',
        qualityTier: 'default',
        runtimeProfile: runtimeProfileForMode(mode),
      };
    });
  }));

  return results;
}
