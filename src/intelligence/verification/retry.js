import { VerificationError, VerificationRateLimitError, VerificationTimeoutError } from './errors.js';
function sleep(ms, signal) {
    if (signal?.aborted)
        return Promise.reject(new VerificationError('Aborted', { code: 'ABORTED', retryable: false }));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new VerificationError('Aborted', { code: 'ABORTED', retryable: false }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function backoffDelay(attempt, initialDelayMs, maxDelayMs, jitter) {
    const raw = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt));
    if (!jitter)
        return raw;
    const spread = raw * 0.2;
    return Math.max(0, raw - spread + Math.random() * spread * 2);
}
function isRetryable(error) {
    if (error instanceof VerificationRateLimitError)
        return true;
    if (error instanceof VerificationTimeoutError)
        return true;
    if (error instanceof VerificationError)
        return error.retryable;
    return false;
}
export async function withRetry(fn, options) {
    const retries = options?.retries ?? 3;
    const initialDelayMs = options?.initialDelayMs ?? 350;
    const maxDelayMs = options?.maxDelayMs ?? 4_000;
    const jitter = options?.jitter ?? true;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (options?.signal?.aborted) {
            throw new VerificationError('Aborted', { code: 'ABORTED', retryable: false });
        }
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt >= retries || !isRetryable(error))
                throw error;
            await sleep(backoffDelay(attempt, initialDelayMs, maxDelayMs, jitter), options?.signal);
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new VerificationError('Verification failed', { retryable: false });
}
//# sourceMappingURL=retry.js.map