// ─── Centralized ATProto Client Adapter ───────────────────────────────────
// All ATProto API calls in the app should go through this module rather than
// calling agent methods directly. This gives us:
//   • typed error normalization on every call
//   • automatic retry with decorrelated jitter for transient failures
//   • per-call AbortController / timeout support
//   • a single place to add logging, metrics, or mocking later
//
// Usage:
//   import { atpCall } from '../lib/atproto/client.js';
//   const feed = await atpCall(() => agent.getTimeline({ limit: 30 }), { signal });

import { withRetry, type RetryOptions } from './retry';
import { normalizeError, type AtpError } from './errors';

export type { AtpError };

export const ATP_AUTH_EXPIRED_EVENT = 'paper:atproto-auth-expired';

let lastAuthExpiredSignalAt = 0;

function notifyAuthExpired(message: string): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  if (now - lastAuthExpiredSignalAt < 1_000) {
    return;
  }

  lastAuthExpiredSignalAt = now;
  window.dispatchEvent(
    new CustomEvent<{ message: string }>(ATP_AUTH_EXPIRED_EVENT, {
      detail: { message },
    }),
  );
}

function recordAuthFailureDebug(kind: string, status: number | undefined, message: string): void {
  if (typeof window === 'undefined') return;
  if (status !== 401 && status !== 403) return;

  const safeMessage = message.slice(0, 220);
  try {
    sessionStorage.setItem(
      'glimpse:oauth:last-auth-failure',
      JSON.stringify({
        timestamp: Date.now(),
        kind,
        status,
        message: safeMessage,
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

export interface CallOptions extends RetryOptions {
  /** Milliseconds before the request is automatically cancelled. Default: 15 000 ms */
  timeoutMs?: number;
}

function composeAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();
  const onAbort = (event: Event) => {
    const source = event.target as AbortSignal | null;
    controller.abort(source?.reason);
    for (const signal of signals) {
      signal.removeEventListener('abort', onAbort);
    }
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
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
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new DOMException('Timed out', 'AbortError'));
  }, timeoutMs);

  const composedSignal = externalSignal
    ? composeAbortSignals([externalSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    return await withRetry(
      (_attempt, _signal) => fn(composedSignal),
      { ...retryOpts, signal: composedSignal }
    );
  } catch (raw) {
    // Re-throw as a normalized error so callers can use err.kind
    const normalized = normalizeError(raw);
    recordAuthFailureDebug(normalized.kind, normalized.status, normalized.message);
    if (normalized.kind === 'auth') {
      notifyAuthExpired(normalized.message);
    }
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
