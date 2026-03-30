function normalizeBaseUrl(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return trimmed.replace(/\/+$/, '');
}
export function getConfiguredApiBaseUrl(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeBaseUrl(candidate);
        if (normalized)
            return normalized;
    }
    return '';
}
export function resolveApiUrl(path, baseUrl = '') {
    if (/^https?:\/\//i.test(path))
        return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (!baseUrl)
        return normalizedPath;
    return new URL(normalizedPath, `${baseUrl}/`).toString();
}
//# sourceMappingURL=apiBase.js.map