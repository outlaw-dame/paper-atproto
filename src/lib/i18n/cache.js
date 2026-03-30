function toKey(key) {
    return `${key.id}::${key.sourceLang}::${key.targetLang}::${key.modelVersion}`;
}
const memoryCache = new Map();
export function getCachedTranslation(key) {
    return memoryCache.get(toKey(key)) ?? null;
}
export function setCachedTranslation(key, result) {
    memoryCache.set(toKey(key), result);
}
export function clearTranslationCacheById(id) {
    const prefix = `${id}::`;
    for (const cacheKey of memoryCache.keys()) {
        if (cacheKey.startsWith(prefix))
            memoryCache.delete(cacheKey);
    }
}
//# sourceMappingURL=cache.js.map