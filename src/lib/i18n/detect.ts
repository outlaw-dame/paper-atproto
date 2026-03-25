import type { LanguageDetectionResult } from './types.js';
import { normalizeLanguageTag } from './normalize.js';

const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
const arabicRegex = /[\u0600-\u06ff]/;
const cyrillicRegex = /[\u0400-\u04ff]/;
const latinRegex = /[a-z]/i;

export function heuristicDetectLanguage(text: string): LanguageDetectionResult {
  const content = text.trim();
  if (!content) return { language: 'und', confidence: 0 };

  if (cjkRegex.test(content)) return { language: 'ja', confidence: 0.65 };
  if (arabicRegex.test(content)) return { language: 'ar', confidence: 0.8 };
  if (cyrillicRegex.test(content)) return { language: 'ru', confidence: 0.75 };
  if (latinRegex.test(content)) return { language: 'en', confidence: 0.4 };

  return { language: 'und', confidence: 0.1 };
}

export function normalizeDetectionResult(result: LanguageDetectionResult): LanguageDetectionResult {
  return {
    language: normalizeLanguageTag(result.language),
    confidence: Math.max(0, Math.min(1, result.confidence)),
  };
}
