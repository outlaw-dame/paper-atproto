export function normalizeLanguageTag(input: string | undefined): string {
  if (!input) return 'und';
  return input.trim().toLowerCase().split(/[_-]/)[0] ?? 'und';
}

export function normalizeTranslatableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isLikelySameLanguage(sourceLang: string, targetLang: string): boolean {
  return normalizeLanguageTag(sourceLang) === normalizeLanguageTag(targetLang);
}

export function hasMeaningfulTranslation(sourceText: string, translatedText: string): boolean {
  const normalizedSource = normalizeTranslatableText(sourceText).toLocaleLowerCase();
  const normalizedTranslated = normalizeTranslatableText(translatedText).toLocaleLowerCase();
  return normalizedTranslated.length > 0 && normalizedTranslated !== normalizedSource;
}
