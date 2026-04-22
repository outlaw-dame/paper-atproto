import crypto from 'node:crypto';
import type { LanguageDetectionResult } from './types.js';

type DetectionCacheEntry = {
  value: LanguageDetectionResult;
  expiresAt: number;
};

const detectionCache = new Map<string, DetectionCacheEntry>();
const DETECTION_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const DETECTION_CACHE_MAX_ENTRIES = 5000;

const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const arabicRegex = /[\u0600-\u06ff]/;
const cyrillicRegex = /[\u0400-\u04ff]/;
const latinRegex = /[a-z]/i;
const ptRegex = /[ãõáàâêôç]/i;
const esRegex = /[ñ¡¿]/i;
const frRegex = /[àâæçéèêëîïôœùûüÿ]/i;
const deRegex = /[äöüß]/i;

type LatinHint = {
  language: string;
  strongRegex?: RegExp;
  tokens: string[];
};

const latinHints: LatinHint[] = [
  { language: 'pt', strongRegex: ptRegex, tokens: [' nao ', ' não ', ' que ', ' para ', ' com ', ' uma ', ' os ', ' as ', ' dos ', ' das ', ' isso ', ' voces ', ' vocês ', ' porque ', ' mais '] },
  { language: 'es', strongRegex: esRegex, tokens: [' que ', ' para ', ' una ', ' pero ', ' como ', ' los ', ' las ', ' del ', ' por ', ' gracias ', ' este ', ' esta ', ' estoy ', ' tienes '] },
  { language: 'fr', strongRegex: frRegex, tokens: [' le ', ' la ', ' les ', ' des ', ' une ', ' pour ', ' avec ', ' est ', ' dans ', ' pas ', ' plus ', ' vous ', ' nous ', ' sur '] },
  { language: 'de', strongRegex: deRegex, tokens: [' der ', ' die ', ' das ', ' und ', ' nicht ', ' ist ', ' ich ', ' mit ', ' für ', ' ein ', ' eine ', ' auf ', ' zu '] },
  { language: 'en', tokens: [' the ', ' and ', ' you ', ' are ', ' with ', ' that ', ' this ', ' have ', ' for ', ' not ', ' but ', ' was ', ' your ', ' they '] },
];

function detectLatinLanguage(content: string): LanguageDetectionResult {
  const lower = ` ${content.toLocaleLowerCase()} `;
  let best: { language: string; score: number } | null = null;
  let runnerUp = 0;

  for (const hint of latinHints) {
    let score = 0;
    if (hint.strongRegex?.test(lower)) score += 3;
    for (const token of hint.tokens) {
      if (lower.includes(token)) score += 1;
    }
    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { language: hint.language, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  if (best && best.score >= 2 && best.score > runnerUp) {
    return { language: best.language, confidence: Math.min(0.92, 0.45 + best.score * 0.08) };
  }

  return { language: 'en', confidence: 0.35 };
}

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function pruneExpired(now = Date.now()): void {
  if (detectionCache.size === 0) return;
  for (const [key, entry] of detectionCache.entries()) {
    if (entry.expiresAt > now) continue;
    detectionCache.delete(key);
  }
}

function enforceBounds(): void {
  while (detectionCache.size > DETECTION_CACHE_MAX_ENTRIES) {
    const oldestKey = detectionCache.keys().next().value;
    if (!oldestKey) break;
    detectionCache.delete(oldestKey);
  }
}

export function detectLanguage(text: string): LanguageDetectionResult {
  const normalized = text.trim();
  if (!normalized) return { language: 'und', confidence: 0 };

  const now = Date.now();
  pruneExpired(now);

  const key = hash(normalized);
  const cached = detectionCache.get(key);
  if (cached && cached.expiresAt > now) {
    // Refresh insertion order so hot keys survive bounded-cache eviction.
    detectionCache.delete(key);
    detectionCache.set(key, cached);
    return cached.value;
  }

  if (cached) {
    detectionCache.delete(key);
  }

  let result: LanguageDetectionResult;
  if (cjkRegex.test(normalized)) result = { language: 'ja', confidence: 0.65 };
  else if (arabicRegex.test(normalized)) result = { language: 'ar', confidence: 0.8 };
  else if (cyrillicRegex.test(normalized)) result = { language: 'ru', confidence: 0.75 };
  else if (latinRegex.test(normalized)) result = detectLatinLanguage(normalized);
  else result = { language: 'und', confidence: 0.1 };

  detectionCache.set(key, {
    value: result,
    expiresAt: now + DETECTION_CACHE_TTL_MS,
  });
  enforceBounds();
  return result;
}

export function getLanguageDetectionCacheStats(): { size: number } {
  return { size: detectionCache.size };
}

export function resetLanguageDetectionCache(): void {
  detectionCache.clear();
}
