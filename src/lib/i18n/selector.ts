import type { TranslationResult } from './types.js';

export function getDisplayText(
  originalText: string,
  translation: TranslationResult | undefined,
  showOriginal: boolean,
): string {
  if (!translation || showOriginal) return originalText;
  return translation.translatedText;
}
