import crypto from 'node:crypto';
import type { LanguageDetectionResult } from './types.js';

const detectionCache = new Map<string, LanguageDetectionResult>();

const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const arabicRegex = /[\u0600-\u06ff]/;
const cyrillicRegex = /[\u0400-\u04ff]/;
const latinRegex = /[a-z]/i;

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function detectLanguage(text: string): LanguageDetectionResult {
  const normalized = text.trim();
  if (!normalized) return { language: 'und', confidence: 0 };

  const key = hash(normalized);
  const cached = detectionCache.get(key);
  if (cached) return cached;

  let result: LanguageDetectionResult;
  if (cjkRegex.test(normalized)) result = { language: 'ja', confidence: 0.65 };
  else if (arabicRegex.test(normalized)) result = { language: 'ar', confidence: 0.8 };
  else if (cyrillicRegex.test(normalized)) result = { language: 'ru', confidence: 0.75 };
  else if (latinRegex.test(normalized)) result = { language: 'en', confidence: 0.4 };
  else result = { language: 'und', confidence: 0.1 };

  detectionCache.set(key, result);
  return result;
}
