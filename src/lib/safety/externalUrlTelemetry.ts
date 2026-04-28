export interface ExternalUrlTelemetrySnapshot {
  attempted: number;
  opened: number;
  rejectedInvalid: number;
  blockedUnsafe: number;
  blockedUnknown: number;
  blockedError: number;
  guardDroppedInvalid: number;
}

const RATE_LIMIT_WINDOW_MS = 30_000;

const metrics: ExternalUrlTelemetrySnapshot = {
  attempted: 0,
  opened: 0,
  rejectedInvalid: 0,
  blockedUnsafe: 0,
  blockedUnknown: 0,
  blockedError: 0,
  guardDroppedInvalid: 0,
};

const nextLogAllowedAt = new Map<string, number>();

function nowMs(): number {
  return Date.now();
}

function withRateLimitedWarn(key: string, message: string, context?: Record<string, unknown>): void {
  const now = nowMs();
  const allowedAt = nextLogAllowedAt.get(key) ?? 0;
  if (now < allowedAt) return;

  nextLogAllowedAt.set(key, now + RATE_LIMIT_WINDOW_MS);
  if (context) {
    console.warn(message, context);
    return;
  }
  console.warn(message);
}

export function recordExternalUrlAttempt(): void {
  metrics.attempted += 1;
}

export function recordExternalUrlOpened(hostname: string | null): void {
  metrics.opened += 1;
  withRateLimitedWarn('[external-url:opened]', '[external-url] opened link', hostname ? { hostname } : undefined);
}

export function recordExternalUrlRejectedInvalid(): void {
  metrics.rejectedInvalid += 1;
  withRateLimitedWarn('[external-url:invalid]', '[external-url] blocked malformed/unsupported URL');
}

export function recordExternalUrlBlockedUnsafe(hostname: string | null): void {
  metrics.blockedUnsafe += 1;
  withRateLimitedWarn('[external-url:unsafe]', '[external-url] blocked unsafe URL verdict', hostname ? { hostname } : undefined);
}

export function recordExternalUrlBlockedUnknown(hostname: string | null): void {
  metrics.blockedUnknown += 1;
  withRateLimitedWarn('[external-url:unknown]', '[external-url] blocked unknown URL verdict (fail-closed)', hostname ? { hostname } : undefined);
}

export function recordExternalUrlBlockedError(error: unknown): void {
  metrics.blockedError += 1;
  const reason = error instanceof Error ? error.message.slice(0, 160) : 'unknown-error';
  withRateLimitedWarn('[external-url:error]', '[external-url] blocked URL due to safety-check error', { reason });
}

export function recordExternalUrlGuardDroppedInvalid(): void {
  metrics.guardDroppedInvalid += 1;
  withRateLimitedWarn('[external-url:guard-drop]', '[external-url] guard dropped invalid _blank href');
}

export function getExternalUrlTelemetrySnapshot(): ExternalUrlTelemetrySnapshot {
  return { ...metrics };
}

export function resetExternalUrlTelemetry(): void {
  metrics.attempted = 0;
  metrics.opened = 0;
  metrics.rejectedInvalid = 0;
  metrics.blockedUnsafe = 0;
  metrics.blockedUnknown = 0;
  metrics.blockedError = 0;
  metrics.guardDroppedInvalid = 0;
  nextLogAllowedAt.clear();
}

if (typeof window !== 'undefined') {
  (window as any).__GLYMPSE_EXTERNAL_URL_SAFETY__ = {
    snapshot: getExternalUrlTelemetrySnapshot,
    reset: resetExternalUrlTelemetry,
  };
}
