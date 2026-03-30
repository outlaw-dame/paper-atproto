export function normalizeLanguageTag(input) {
    if (!input)
        return 'und';
    return input.trim().toLowerCase().split(/[_-]/)[0] ?? 'und';
}
export function normalizeTranslatableText(text) {
    return text.replace(/\s+/g, ' ').trim();
}
export function isLikelySameLanguage(sourceLang, targetLang) {
    return normalizeLanguageTag(sourceLang) === normalizeLanguageTag(targetLang);
}
export function hasMeaningfulTranslation(sourceText, translatedText) {
    const normalizedSource = normalizeTranslatableText(sourceText).toLocaleLowerCase();
    const normalizedTranslated = normalizeTranslatableText(translatedText).toLocaleLowerCase();
    return normalizedTranslated.length > 0 && normalizedTranslated !== normalizedSource;
}
//# sourceMappingURL=normalize.js.map