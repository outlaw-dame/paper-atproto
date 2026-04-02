import crypto from 'node:crypto';
import type { TranslationResult } from './types.js';

type CacheEntry = {
  value: TranslationResult;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;
const MAX_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_CACHE_ENTRIES = 5000;

export function translationTextHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function translationCacheKey(input: {
  sourceLang: string;
  targetLang: string;
  modelVersion: string;
  sourceText: string;
}): string {
  const sourceLang = input.sourceLang.trim().toLowerCase();
  const targetLang = input.targetLang.trim().toLowerCase();
  const modelVersion = input.modelVersion.trim();
  return [
    sourceLang,
    targetLang,
    modelVersion,
    translationTextHash(input.sourceText),
  ].join('::');
}

function pruneExpired(now = Date.now()): void {
  if (cache.size === 0) return;
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt > now) continue;
    cache.delete(key);
  }
}

function enforceBounds(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function getTranslationCache(key: string): TranslationResult | null {
  const now = Date.now();
  pruneExpired(now);

  const entry = cache.get(key);
  if (!entry) return null;

  // Refresh insertion order so hot keys survive bounded-cache eviction.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function setTranslationCache(key: string, value: TranslationResult, ttlMs = DEFAULT_TTL_MS): void {
  pruneExpired();
  const boundedTtlMs = Number.isFinite(ttlMs)
    ? Math.max(1000, Math.min(MAX_TTL_MS, Math.floor(ttlMs)))
    : DEFAULT_TTL_MS;
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + boundedTtlMs });
  enforceBounds();
}

export function getTranslationCacheStats(): { size: number } {
  return { size: cache.size };
}

export function resetTranslationCache(): void {
  cache.clear();
}
