/**
 * Utility to fetch and parse OpenGraph metadata from a URL.
 * In a local-first/PWA context, we need a proxy to bypass CORS.
 *
 * Author attribution emulates the Mastodon fediverse:creator feature (added in
 * Mastodon 4.3). When a page includes <meta name="fediverse:creator" content="@user@instance.social">
 * Mastodon shows a "More from…" attribution on link cards. We do the same.
 *
 * Author display-name extraction priority:
 *   1. article:author     — OG article author (name strings only; URLs are skipped)
 *   2. author             — standard meta name
 *   3. dc:creator         — Dublin Core creator
 *
 * Fediverse handle:
 *   - fediverse:creator   — Mastodon/ActivityPub handle like "@user@mastodon.social"
 *   - No ATProto equivalent exists yet (open proposal: atproto#3562)
 */
const PROXY_TARGETS = [
    {
        id: 'codetabs',
        kind: 'raw',
        buildUrl: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    },
];
const FETCH_TIMEOUT_MS = 7000;
const PROXY_COOLDOWN_MS = 10 * 60 * 1000;
const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS = new Set([
    'amp',
    'amp_js_v',
    'amp_gsa',
    'amp_tf',
    'ampshare',
    'aoh',
    'csi',
    'referrer',
    'fbclid',
    'gclid',
    'igshid',
    'mc_cid',
    'mc_eid',
]);
// Simple in-memory cache so repeated renders don't re-fetch the same URL.
const cache = new Map();
// Circuit breaker per proxy target to avoid hammering blocked/rate-limited providers.
const proxyDisabledUntil = new Map();
export const fetchOGData = (url) => {
    const normalizedUrl = normalizeOGUrl(url);
    const cached = cache.get(normalizedUrl);
    if (cached)
        return cached;
    const promise = _fetchOGData(normalizedUrl);
    cache.set(normalizedUrl, promise);
    return promise;
};
function buildMetaOnlyHtml(rawHtml) {
    const headContent = rawHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? rawHtml;
    const metaTags = headContent.match(/<meta\b[^>]*>/gi) ?? [];
    const title = headContent.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[0] ?? '';
    // Parse only title + meta tags so no stylesheet/font/preload/script requests fire.
    return `<!doctype html><html><head>${title}${metaTags.join('')}</head><body></body></html>`;
}
async function _fetchOGData(url) {
    try {
        const rawHtml = await fetchHtmlThroughProxy(url);
        if (!rawHtml)
            return null;
        const html = buildMetaOnlyHtml(rawHtml);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const getMeta = (property) => {
            return (doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ||
                doc.querySelector(`meta[name="${property}"]`)?.getAttribute('content') ||
                undefined);
        };
        // fediverse:creator is a Mastodon/ActivityPub handle like "@user@instance.social"
        // Spec: https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/
        const fediverseCreator = getMeta('fediverse:creator');
        // Normalise: ensure leading @ (both "@user@instance" and "user@instance" are valid)
        const authorHandle = fediverseCreator
            ? (fediverseCreator.startsWith('@') ? fediverseCreator : `@${fediverseCreator}`)
            : undefined;
        // Derive a linkable profile URL from the handle, e.g. "@user@mastodon.social" → "https://mastodon.social/@user"
        let authorProfileUrl;
        if (authorHandle) {
            // Strip leading @, then split "user@instance.social"
            const withoutLeading = authorHandle.startsWith('@') ? authorHandle.slice(1) : authorHandle;
            const atIdx = withoutLeading.indexOf('@');
            if (atIdx !== -1) {
                const username = withoutLeading.slice(0, atIdx);
                const instance = withoutLeading.slice(atIdx + 1);
                authorProfileUrl = `https://${instance}/@${username}`;
            }
        }
        // article:author per the OG spec is a profile *URL*, not a name.
        // Many sites use it as a plain name string, so we accept it only when it
        // doesn't look like a URL.
        const isUrl = (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/');
        const articleAuthorRaw = getMeta('article:author');
        const articleAuthor = articleAuthorRaw && !isUrl(articleAuthorRaw) ? articleAuthorRaw : undefined;
        const author = articleAuthor ||
            getMeta('author') ||
            getMeta('dc:creator') ||
            undefined;
        const metadata = { url };
        const title = getMeta('og:title') || doc.title;
        if (title)
            metadata.title = title;
        const description = getMeta('og:description') || getMeta('description');
        if (description)
            metadata.description = description;
        const image = getMeta('og:image');
        if (image)
            metadata.image = image;
        const siteName = getMeta('og:site_name');
        if (siteName)
            metadata.siteName = siteName;
        if (author)
            metadata.author = author;
        if (authorHandle)
            metadata.authorHandle = authorHandle;
        if (authorProfileUrl)
            metadata.authorProfileUrl = authorProfileUrl;
        // Handle relative image URLs
        if (metadata.image && !metadata.image.startsWith('http')) {
            try {
                const baseUrl = new URL(url);
                metadata.image = new URL(metadata.image, baseUrl.origin).toString();
            }
            catch {
                // Leave as-is if URL parsing fails
            }
        }
        return metadata;
    }
    catch (error) {
        // OG metadata is best-effort; avoid noisy console errors for expected proxy failures.
        if (import.meta.env.DEV) {
            console.warn('OG metadata fetch failed:', error);
        }
        return null;
    }
}
function normalizeOGUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return rawUrl;
        }
        const ampShare = parsed.searchParams.get('ampshare');
        if (ampShare) {
            try {
                const decoded = decodeURIComponent(ampShare);
                const nested = new URL(decoded);
                if (nested.protocol === 'http:' || nested.protocol === 'https:') {
                    parsed.protocol = nested.protocol;
                    parsed.hostname = nested.hostname;
                    parsed.port = nested.port;
                    parsed.pathname = nested.pathname;
                    parsed.search = nested.search;
                    parsed.hash = nested.hash;
                }
            }
            catch {
                // If ampshare is malformed, continue with the base URL.
            }
        }
        parsed.hash = '';
        const keys = Array.from(parsed.searchParams.keys());
        for (const key of keys) {
            const lower = key.toLowerCase();
            const prefixed = TRACKING_PARAM_PREFIXES.some(prefix => lower.startsWith(prefix));
            if (prefixed || TRACKING_PARAMS.has(lower)) {
                parsed.searchParams.delete(key);
            }
        }
        return parsed.toString();
    }
    catch {
        return rawUrl;
    }
}
async function fetchHtmlThroughProxy(url) {
    const now = Date.now();
    for (const target of PROXY_TARGETS) {
        const disabledUntil = proxyDisabledUntil.get(target.id) ?? 0;
        if (disabledUntil > now) {
            continue;
        }
        try {
            const response = await fetchWithTimeout(target.buildUrl(url), FETCH_TIMEOUT_MS);
            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    proxyDisabledUntil.set(target.id, now + PROXY_COOLDOWN_MS);
                }
                continue;
            }
            const raw = await response.text();
            if (looksLikeProxyBlockedPage(raw)) {
                proxyDisabledUntil.set(target.id, now + PROXY_COOLDOWN_MS);
                continue;
            }
            if (raw.trim())
                return raw;
        }
        catch {
            // Try next proxy target.
        }
    }
    return null;
}
function looksLikeProxyBlockedPage(html) {
    const lower = html.toLowerCase();
    return (lower.includes('corsproxy.io/_next/static/media/') ||
        lower.includes('too many requests') ||
        lower.includes('access denied') ||
        lower.includes('forbidden'));
}
async function fetchWithTimeout(input, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { signal: controller.signal });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
//# sourceMappingURL=og.js.map