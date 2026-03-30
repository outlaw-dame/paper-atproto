// ─── ATProto Error Normalization ───────────────────────────────────────────
// Classifies every error that can come back from BskyAgent calls into a typed,
// actionable shape so callers never have to inspect raw error messages.
// HTTP status codes that are safe to retry with backoff
export const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
// HTTP status codes that must NEVER be retried
export const FATAL_STATUSES = new Set([400, 401, 403, 404]);
function parseRetryAfterMs(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.max(0, Math.round(seconds * 1000));
    }
    const retryAt = Date.parse(trimmed);
    if (!Number.isNaN(retryAt)) {
        return Math.max(0, retryAt - Date.now());
    }
    return undefined;
}
function isNetworkLikeError(err) {
    if (!(err instanceof Error))
        return false;
    const name = err.name.toLowerCase();
    const message = err.message.toLowerCase();
    return (name === 'typeerror' ||
        name === 'networkerror' ||
        message.includes('fetch') ||
        message.includes('networkerror') ||
        message.includes('load failed') ||
        message.includes('failed to fetch') ||
        message.includes('network request failed'));
}
export function normalizeError(err) {
    // AbortError — request was cancelled intentionally
    if (err instanceof DOMException && err.name === 'AbortError') {
        return { kind: 'cancelled', message: 'Request cancelled', original: err };
    }
    // Network failure (fetch threw before getting a response)
    if (isNetworkLikeError(err)) {
        return { kind: 'network', message: 'Network error — check your connection', original: err };
    }
    // @atproto/api wraps HTTP errors with a `status` field
    const anyErr = err;
    const status = anyErr?.status ?? anyErr?.error?.status;
    const message = anyErr?.message ?? anyErr?.error?.message ?? String(err);
    const lowerMessage = message.toLowerCase();
    if (status === 401 || lowerMessage.includes('authenticationrequired') || lowerMessage.includes('expiredtoken')) {
        return { kind: 'auth', message: 'Session expired — please sign in again', status, original: err };
    }
    if (status === 403) {
        if (lowerMessage.includes('insufficient_scope')
            || lowerMessage.includes('insufficient scope')
            || lowerMessage.includes('invalid_token')
            || lowerMessage.includes('invalid token')
            || lowerMessage.includes('permission scope')) {
            return {
                kind: 'auth',
                message: 'Your granted permissions are insufficient. Please sign in again and approve access.',
                status,
                original: err,
            };
        }
        return { kind: 'forbidden', message: 'You do not have permission to do that', status, original: err };
    }
    if (status === 404) {
        return { kind: 'not_found', message: 'Not found', status, original: err };
    }
    if (status === 429) {
        const retryAfter = anyErr?.headers?.get?.('Retry-After');
        const retryAfterMs = parseRetryAfterMs(retryAfter);
        return { kind: 'rate_limit', message: 'Rate limited — please wait a moment', status, retryAfterMs, original: err };
    }
    if (status && status >= 500) {
        return { kind: 'server', message: 'Server error — please try again shortly', status, original: err };
    }
    return { kind: 'unknown', message, status, original: err };
}
export function isRetryable(err) {
    if (err.kind === 'cancelled')
        return false;
    if (err.kind === 'auth' || err.kind === 'forbidden' || err.kind === 'not_found')
        return false;
    if (err.kind === 'rate_limit' || err.kind === 'server' || err.kind === 'network')
        return true;
    return false;
}
//# sourceMappingURL=errors.js.map