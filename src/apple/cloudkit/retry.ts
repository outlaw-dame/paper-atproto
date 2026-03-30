// ─── CloudKit Retry / Circuit Breaker ────────────────────────────────────────

import { isRetryableCloudKitError } from './errors.js';

export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}

const DEFAULT_POLICY: RetryPolicy = {
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  maxAttempts: 5,
};

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type BreakerState = 'closed' | 'open' | 'half-open';

interface BreakerStatus {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt?: number;
  lastSuccessAt?: number;
}

const BREAKER_OPEN_THRESHOLD = 5;
const BREAKER_HALF_OPEN_DELAY_MS = 5 * 60 * 1000;
const BREAKER_CLOSE_SUCCESSES = 2;

let _breaker: BreakerStatus = { state: 'closed', consecutiveFailures: 0 };
let _halfOpenSuccesses = 0;

function isBreakerOpen(): boolean {
  if (_breaker.state === 'closed') return false;
  if (_breaker.state === 'open') {
    const elapsed = Date.now() - (_breaker.openedAt ?? 0);
    if (elapsed >= BREAKER_HALF_OPEN_DELAY_MS) {
      _breaker.state = 'half-open';
      _halfOpenSuccesses = 0;
      return false;
    }
    return true;
  }
  // half-open: allow one probe
  return false;
}

function recordSuccess() {
  if (_breaker.state === 'half-open') {
    _halfOpenSuccesses++;
    if (_halfOpenSuccesses >= BREAKER_CLOSE_SUCCESSES) {
      _breaker = { state: 'closed', consecutiveFailures: 0, lastSuccessAt: Date.now() };
    }
  } else {
    _breaker.consecutiveFailures = 0;
    _breaker.lastSuccessAt = Date.now();
  }
}

function recordFailure() {
  _breaker.consecutiveFailures++;
  if (
    _breaker.state === 'closed' &&
    _breaker.consecutiveFailures >= BREAKER_OPEN_THRESHOLD
  ) {
    _breaker = { state: 'open', consecutiveFailures: _breaker.consecutiveFailures, openedAt: Date.now() };
  }
}

// ─── Retry with full jitter ───────────────────────────────────────────────────

export async function retryWithFullJitter<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_POLICY
): Promise<T> {
  if (isBreakerOpen()) {
    throw new Error('CloudKit circuit breaker open');
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryableCloudKitError(err)) {
        recordFailure();
        throw err;
      }
      recordFailure();
      if (attempt < policy.maxAttempts - 1) {
        const ceiling = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
        await delay(Math.floor(Math.random() * ceiling));
      }
    }
  }

  throw lastErr;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getBreakerState(): BreakerState {
  return _breaker.state;
}
