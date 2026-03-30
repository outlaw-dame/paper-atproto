export function getDisplayText(originalText, translation, showOriginal) {
    if (!translation || showOriginal)
        return originalText;
    return translation.translatedText;
}
//# sourceMappingURL=selector.js.map