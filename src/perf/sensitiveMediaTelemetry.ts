interface SensitiveMediaMetricsSnapshot {
  impressions: number;
  reveals: number;
  reHides: number;
  droppedEvents: number;
  queuedEvents: number;
  lastFlushAt: number | null;
}

type SensitiveMediaEventType = 'impression' | 'reveal' | 'rehide';

interface SensitiveMediaEvent {
  type: SensitiveMediaEventType;
  reasonCount: number;
  ts: number;
}

const MAX_QUEUE_SIZE = 64;
const FLUSH_BATCH_SIZE = 12;
const FLUSH_DEBOUNCE_MS = 8_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 4_000;
const RETRY_JITTER = 0.25;
const REQUEST_TIMEOUT_MS = 6_000;

const metrics: SensitiveMediaMetricsSnapshot = {
  impressions: 0,
  reveals: 0,
  reHides: 0,
  droppedEvents: 0,
  queuedEvents: 0,
  lastFlushAt: null,
};

const queue: SensitiveMediaEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function endpoint(): string {
  const value = (import.meta as any).env?.VITE_GLYMPSE_SENSITIVE_TELEMETRY_URL;
  return typeof value === 'string' ? value.trim() : '';
}

function toBackoffDelay(attempt: number): number {
  const exp = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  const jitter = exp * RETRY_JITTER;
  return Math.floor(exp - jitter + Math.random() * jitter * 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishSnapshot() {
  if (typeof window === 'undefined') return;
  (window as Window & { __GLYMPSE_SENSITIVE_MEDIA_METRICS__?: SensitiveMediaMetricsSnapshot }).__GLYMPSE_SENSITIVE_MEDIA_METRICS__ = {
    ...metrics,
    queuedEvents: queue.length,
  };
}

function enqueue(type: SensitiveMediaEventType, reasonCount: number): void {
  if (queue.length >= MAX_QUEUE_SIZE) {
    metrics.droppedEvents += 1;
    publishSnapshot();
    return;
  }

  queue.push({
    type,
    reasonCount: Math.max(0, Math.min(6, Math.trunc(reasonCount))),
    ts: Date.now(),
  });

  metrics.queuedEvents = queue.length;
  publishSnapshot();
}

function buildPayload(batch: SensitiveMediaEvent[]) {
  const totals = { impression: 0, reveal: 0, rehide: 0 };

  for (const evt of batch) {
    totals[evt.type] += 1;
  }

  return {
    v: 1,
    emittedAt: Date.now(),
    count: batch.length,
    totals,
  };
}

async function postWithRetry(url: string, body: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
        keepalive: true,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        const err = new Error(`Sensitive media telemetry failed (${response.status})`);
        lastError = err;
        if (attempt === RETRY_ATTEMPTS - 1) throw err;
        await sleep(toBackoffDelay(attempt));
        continue;
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS - 1) throw error;
      await sleep(toBackoffDelay(attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Unknown telemetry delivery error');
}

async function flushNowInternal(optedIn: boolean): Promise<void> {
  if (flushing || queue.length === 0) return;
  if (!optedIn) {
    queue.length = 0;
    publishSnapshot();
    return;
  }

  const url = endpoint();
  if (!url) {
    queue.length = 0;
    publishSnapshot();
    return;
  }

  flushing = true;
  const batch = queue.splice(0, FLUSH_BATCH_SIZE);

  try {
    await postWithRetry(url, JSON.stringify(buildPayload(batch)));
    metrics.lastFlushAt = Date.now();
  } catch {
    queue.unshift(...batch);
  } finally {
    flushing = false;
    metrics.queuedEvents = queue.length;
    publishSnapshot();
  }
}

function scheduleFlush(optedIn: boolean): void {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNowInternal(optedIn);
  }, FLUSH_DEBOUNCE_MS);
}

export function recordSensitiveMediaImpression(reasonCount: number, optedIn: boolean): void {
  metrics.impressions += 1;
  enqueue('impression', reasonCount);
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushNowInternal(optedIn);
  } else {
    scheduleFlush(optedIn);
  }
}

export function recordSensitiveMediaReveal(reasonCount: number, optedIn: boolean): void {
  metrics.reveals += 1;
  enqueue('reveal', reasonCount);
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushNowInternal(optedIn);
  } else {
    scheduleFlush(optedIn);
  }
}

export function recordSensitiveMediaRehide(reasonCount: number, optedIn: boolean): void {
  metrics.reHides += 1;
  enqueue('rehide', reasonCount);
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushNowInternal(optedIn);
  } else {
    scheduleFlush(optedIn);
  }
}

export function getSensitiveMediaMetricsSnapshot(): SensitiveMediaMetricsSnapshot {
  return {
    ...metrics,
    queuedEvents: queue.length,
  };
}
