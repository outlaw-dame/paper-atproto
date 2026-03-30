// ─── Retry — ATProto thread loading ──────────────────────────────────────
// Thin wrapper around the shared lib retry utility with thread-loading
// defaults. Thread fetches get slightly more aggressive retries than
// general API calls because a failed thread open is highly visible.
export { withRetry } from '../lib/atproto/retry.js';
// Default retry configuration for thread-loading operations.
// The cap is set to 12 s so a worst-case retry sequence takes ~20 s total.
export const THREAD_RETRY_DEFAULTS = {
    maxAttempts: 4,
    baseDelayMs: 400,
    capDelayMs: 12_000,
};
//# sourceMappingURL=retry.js.map