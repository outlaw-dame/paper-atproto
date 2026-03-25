import crypto from 'node:crypto';
import type { TranslationResult } from './types.js';

type CacheEntry = {
  value: TranslationResult;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;

export function translationTextHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function translationCacheKey(input: {
  id: string;
  sourceLang: string;
  targetLang: string;
  modelVersion: string;
  sourceText: string;
}): string {
  return [
    input.id,
    input.sourceLang,
    input.targetLang,
    input.modelVersion,
    translationTextHash(input.sourceText),
  ].join('::');
}

export function getTranslationCache(key: string): TranslationResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setTranslationCache(key: string, value: TranslationResult, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
