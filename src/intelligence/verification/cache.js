export class InMemoryVerificationCache {
    map = new Map();
    async get(key) {
        const hit = this.map.get(key);
        if (!hit)
            return null;
        if (hit.expiresAt && Date.now() > hit.expiresAt) {
            this.map.delete(key);
            return null;
        }
        return hit.value;
    }
    async set(key, value, ttlMs = 5 * 60_000) {
        this.map.set(key, {
            value,
            ...(ttlMs > 0 ? { expiresAt: Date.now() + ttlMs } : {}),
        });
    }
}
export function verificationCacheKey(postUri, text) {
    const normalizedText = text.trim().replace(/\s+/g, ' ').slice(0, 512);
    return `${postUri}::${normalizedText}`;
}
//# sourceMappingURL=cache.js.map