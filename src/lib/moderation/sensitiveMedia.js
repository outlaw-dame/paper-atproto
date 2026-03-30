const CATEGORY_KEYWORDS = {
    sexual: ['porn', 'sexual', 'sex', 'adult'],
    nudity: ['nudity', 'nude', 'explicit-nudity'],
    graphicViolence: ['graphic-media', 'graphic-violence', 'gore', 'violence', 'blood'],
};
function normalizeToken(raw) {
    return raw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9:_-]/g, '')
        .slice(0, 64);
}
function sanitizeReasons(values) {
    const unique = new Set();
    for (const value of values) {
        const normalized = normalizeToken(value);
        if (!normalized)
            continue;
        unique.add(normalized);
        if (unique.size >= 6)
            break;
    }
    return [...unique];
}
function isSensitiveLabel(value) {
    const normalized = normalizeToken(value);
    if (!normalized)
        return false;
    const allKeywords = [
        ...CATEGORY_KEYWORDS.sexual,
        ...CATEGORY_KEYWORDS.nudity,
        ...CATEGORY_KEYWORDS.graphicViolence,
    ];
    return allKeywords.some((token) => normalized.includes(token));
}
function hasVisualMedia(post) {
    if (Boolean(post.media?.length) || post.embed?.type === 'video')
        return true;
    if (post.embed?.type === 'quote') {
        const q = post.embed.post;
        return Boolean(q.media?.length) || q.embed?.type === 'video';
    }
    return false;
}
export function detectSensitiveMedia(post) {
    if (post.sensitiveMedia?.isSensitive) {
        const rawReasons = sanitizeReasons(post.sensitiveMedia.reasons ?? []);
        const reasons = rawReasons.filter(isSensitiveLabel);
        return {
            isSensitive: hasVisualMedia(post) && reasons.length > 0,
            reasons,
            source: 'post',
        };
    }
    const postLabels = Array.isArray(post.contentLabels) ? post.contentLabels : [];
    const sensitiveMatches = postLabels.filter(isSensitiveLabel);
    return {
        isSensitive: sensitiveMatches.length > 0 && hasVisualMedia(post),
        reasons: sanitizeReasons(sensitiveMatches),
        source: 'label',
    };
}
export function mapRawLabelValues(raw) {
    if (!Array.isArray(raw))
        return [];
    const values = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const maybeVal = item.val;
        if (typeof maybeVal !== 'string')
            continue;
        values.push(maybeVal);
        if (values.length >= 20)
            break;
    }
    return sanitizeReasons(values);
}
//# sourceMappingURL=sensitiveMedia.js.map