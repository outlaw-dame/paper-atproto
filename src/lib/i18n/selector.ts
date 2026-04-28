import type { TranslationResult } from './types';

export function getDisplayText(
  originalText: string,
  translation: TranslationResult | undefined,
  showOriginal: boolean,
): string {
  if (!translation || showOriginal) return originalText;
  return translation.translatedText;
}
