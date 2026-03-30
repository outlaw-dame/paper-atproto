import type { TranslationResult } from './types';

export type TranslationCacheKey = {
  id: string;
  sourceLang: string;
  targetLang: string;
  modelVersion: string;
};

function toKey(key: TranslationCacheKey): string {
  return `${key.id}::${key.sourceLang}::${key.targetLang}::${key.modelVersion}`;
}

const memoryCache = new Map<string, TranslationResult>();

export function getCachedTranslation(key: TranslationCacheKey): TranslationResult | null {
  return memoryCache.get(toKey(key)) ?? null;
}

export function setCachedTranslation(key: TranslationCacheKey, result: TranslationResult): void {
  memoryCache.set(toKey(key), result);
}

export function clearTranslationCacheById(id: string): void {
  const prefix = `${id}::`;
  for (const cacheKey of memoryCache.keys()) {
    if (cacheKey.startsWith(prefix)) memoryCache.delete(cacheKey);
  }
}
