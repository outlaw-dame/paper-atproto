// ─── Model Client — Narwhal v3 ────────────────────────────────────────────
// Client-side fetch wrappers for the server-side LLM endpoints.
// All model calls are server-side only — this client calls the backend.
// Includes timeout, exponential backoff + jitter, typed response validation.
import { getConfiguredApiBaseUrl, resolveApiUrl } from '../lib/apiBase.js';
// ─── Config ───────────────────────────────────────────────────────────────
const BASE_URL = getConfiguredApiBaseUrl(import.meta.env?.VITE_GLYMPSE_LLM_BASE_URL, import.meta.env?.VITE_GLYMPSE_API_BASE_URL);
const RETRY_BASE_MS = 300;
const RETRY_MAX_MS = 4000;
const RETRY_ATTEMPTS = 3;
const RETRY_JITTER = 0.30;
const DEFAULT_TIMEOUT_MS = 30_000;
// ─── Retry helpers ────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function backoffMs(attempt) {
    const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
    const jitter = exp * RETRY_JITTER;
    return Math.floor(exp - jitter + Math.random() * jitter * 2);
}
function isRetryable(status) {
    return [408, 429, 500, 502, 503, 504].includes(status);
}
async function fetchWithRetry(path, body, signal) {
    let lastError;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        const combinedSignal = signal ?? controller.signal;
        try {
            const endpoint = resolveApiUrl(path, BASE_URL);
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: combinedSignal,
            });
            if (!res.ok) {
                if (!isRetryable(res.status) || attempt === RETRY_ATTEMPTS - 1) {
                    throw new Error(`LLM endpoint ${path} responded ${res.status}`);
                }
                lastError = new Error(`LLM endpoint ${path} responded ${res.status}`);
                await sleep(backoffMs(attempt));
                continue;
            }
            return (await res.json());
        }
        catch (err) {
            lastError = err;
            const isAbort = err instanceof Error && err.name === 'AbortError';
            if (isAbort || attempt === RETRY_ATTEMPTS - 1)
                throw err;
            await sleep(backoffMs(attempt));
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    throw lastError;
}
// ─── Public API ───────────────────────────────────────────────────────────
/**
 * Calls the writer model to produce the Interpolator summary.
 * Falls back gracefully — callers should catch and use deterministic summary on failure.
 */
export async function callInterpolatorWriter(input, signal) {
    return fetchWithRetry('/api/llm/write/interpolator', input, signal);
}
/**
 * Calls the multimodal analyzer (Qwen3-VL).
 * Only call when shouldRunMultimodal() returns true.
 */
export async function callMediaAnalyzer(input, signal) {
    return fetchWithRetry('/api/llm/analyze/media', input, signal);
}
/**
 * Calls the writer for Explore / Search Story synopsis.
 */
export async function callExploreWriter(input, signal) {
    return fetchWithRetry('/api/llm/write/search-story', input, signal);
}
/**
 * Calls the selective composer-guidance writer. This is advisory polish only;
 * callers should always have local fallback copy ready.
 */
export async function callComposerGuidanceWriter(input, signal) {
    return fetchWithRetry('/api/llm/write/composer-guidance', input, signal);
}
//# sourceMappingURL=modelClient.js.map