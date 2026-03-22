// ─── Centralized ATProto Client Adapter ───────────────────────────────────
// All ATProto API calls in the app should go through this module rather than
// calling agent methods directly. This gives us:
//   • typed error normalization on every call
//   • automatic retry with decorrelated jitter for transient failures
//   • per-call AbortController / timeout support
//   • a single place to add logging, metrics, or mocking later
//
// Usage:
//   import { atpCall } from '../lib/atproto/client';
//   const feed = await atpCall(() => agent.getTimeline({ limit: 30 }), { signal });

import { withRetry, type RetryOptions } from './retry';
import { normalizeError, type AtpError } from './errors';

export type { AtpError };

export interface CallOptions extends RetryOptions {
  /** Milliseconds before the request is automatically cancelled. Default: 15 000 ms */
  timeoutMs?: number;
}

/**
 * Wraps any ATProto agent call with retry, error normalization, and timeout.
 * Throws a normalized `AtpError`-shaped object on failure.
 */
export async function atpCall<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: CallOptions = {}
): Promise<T> {
  const { timeoutMs = 15_000, signal: externalSignal, ...retryOpts } = opts;

  // Compose the caller's signal with our timeout signal
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const composedSignal = externalSignal
    ? AbortSignal.any
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal   // fallback for older browsers
    : timeoutController.signal;

  try {
    return await withRetry(
      (_attempt, _signal) => fn(composedSignal),
      { ...retryOpts, signal: composedSignal }
    );
  } catch (raw) {
    // Re-throw as a normalized error so callers can use err.kind
    const normalized = normalizeError(raw);
    const enriched = Object.assign(new Error(normalized.message), normalized);
    throw enriched;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Convenience: fire-and-forget with no retry (e.g. like/repost mutations).
 * Returns null on failure instead of throwing, so UI can handle it gracefully.
 */
export async function atpMutate<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: Omit<CallOptions, 'maxAttempts'> = {}
): Promise<T | null> {
  try {
    return await atpCall(fn, { ...opts, maxAttempts: 1 });
  } catch {
    return null;
  }
}
