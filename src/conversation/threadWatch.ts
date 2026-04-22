import { isAtUri } from '../lib/resolver/atproto';
import {
  recordConversationWatchConnectionState,
  recordConversationWatchInvalidation,
  recordConversationWatchStatus,
} from '../perf/interpolatorTelemetry';

const THREAD_WATCH_ENDPOINT = '/api/conversation/watch';
const DEFAULT_RECONNECT_BASE_MS = 1_500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export interface ConversationThreadInvalidationEvent {
  rootUri: string;
  reason: 'remote_thread_changed';
  observedAt: string;
  sequence?: number;
  replyCount?: number;
  nodeCount?: number;
  latestReplyAt?: string | null;
}

interface ConversationThreadStatusEvent {
  rootUri: string;
  state: 'degraded' | 'reconnect';
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  observedAt: string;
}

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.trunc(numeric);
}

function normalizeTimestamp(value: unknown): string | null {
  const raw = normalizeBoundedString(value, 64);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function buildConversationThreadWatchUrl(rootUri: string): string {
  const safeRootUri = normalizeBoundedString(rootUri, 320);
  if (!safeRootUri || typeof window === 'undefined') return THREAD_WATCH_ENDPOINT;
  const url = new URL(THREAD_WATCH_ENDPOINT, window.location.origin);
  url.searchParams.set('rootUri', safeRootUri);
  return url.toString();
}

export function normalizeConversationThreadInvalidationEvent(
  value: unknown,
): ConversationThreadInvalidationEvent | null {
  const event = value as Record<string, unknown> | null;
  const rootUri = normalizeBoundedString(event?.rootUri, 320);
  const observedAt = normalizeTimestamp(event?.observedAt);
  const reason = event?.reason;

  if (!rootUri || !isAtUri(rootUri) || observedAt == null || reason !== 'remote_thread_changed') {
    return null;
  }

  const sequence = normalizePositiveInteger(event?.sequence);
  const replyCount = normalizePositiveInteger(event?.replyCount);
  const nodeCount = normalizePositiveInteger(event?.nodeCount);
  const latestReplyAt = normalizeTimestamp(event?.latestReplyAt);

  return {
    rootUri,
    reason,
    observedAt,
    ...(sequence !== undefined ? { sequence } : {}),
    ...(replyCount !== undefined ? { replyCount } : {}),
    ...(nodeCount !== undefined ? { nodeCount } : {}),
    ...(latestReplyAt !== null ? { latestReplyAt } : {}),
  };
}

function normalizeConversationThreadStatusEvent(
  value: unknown,
): ConversationThreadStatusEvent | null {
  const event = value as Record<string, unknown> | null;
  const rootUri = normalizeBoundedString(event?.rootUri, 320);
  const observedAt = normalizeTimestamp(event?.observedAt);
  const state = event?.state;

  if (!rootUri || !isAtUri(rootUri) || observedAt == null) return null;
  if (state !== 'degraded' && state !== 'reconnect') return null;

  const code = normalizeBoundedString(event?.code, 64);
  const retryAfterMs = normalizePositiveInteger(event?.retryAfterMs);

  return {
    rootUri,
    state,
    ...(code ? { code } : {}),
    ...(typeof event?.retryable === 'boolean' ? { retryable: event.retryable } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    observedAt,
  };
}

function safeParseEventData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function computeConversationThreadWatchReconnectDelayMs(
  attempt: number,
  preferredDelayMs?: number,
  baseDelayMs: number = DEFAULT_RECONNECT_BASE_MS,
  maxDelayMs: number = DEFAULT_RECONNECT_MAX_MS,
): number {
  if (typeof preferredDelayMs === 'number' && Number.isFinite(preferredDelayMs) && preferredDelayMs > 0) {
    return Math.max(750, Math.min(maxDelayMs, Math.floor(preferredDelayMs)));
  }

  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt)));
  const spread = Math.floor(exponential * 0.25);
  const min = Math.max(500, exponential - spread);
  const max = exponential + spread;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function subscribeConversationThreadWatch(params: {
  rootUri: string;
  onInvalidation: (event: ConversationThreadInvalidationEvent) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  onConnectionStateChange?: (state: 'connecting' | 'ready' | 'retrying' | 'closed') => void;
}): () => void {
  const {
    rootUri,
    onInvalidation,
    reconnectBaseMs = DEFAULT_RECONNECT_BASE_MS,
    reconnectMaxMs = DEFAULT_RECONNECT_MAX_MS,
    onConnectionStateChange,
  } = params;

  if (
    typeof window === 'undefined'
    || typeof EventSource === 'undefined'
    || !isAtUri(rootUri)
  ) {
    return () => {};
  }

  let closed = false;
  let source: EventSource | null = null;
  let reconnectTimeoutId: number | null = null;
  let reconnectAttempt = 0;
  let preferredReconnectDelayMs: number | undefined;

  const clearReconnect = () => {
    if (reconnectTimeoutId !== null) {
      window.clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  };

  const disposeSource = () => {
    if (!source) return;
    source.close();
    source = null;
  };

  const scheduleReconnect = () => {
    if (closed) return;
    clearReconnect();
    const delayMs = computeConversationThreadWatchReconnectDelayMs(
      reconnectAttempt,
      preferredReconnectDelayMs,
      reconnectBaseMs,
      reconnectMaxMs,
    );
    preferredReconnectDelayMs = undefined;
    reconnectAttempt += 1;
    onConnectionStateChange?.('retrying');
    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null;
      connect();
    }, delayMs);
  };

  const connect = () => {
    if (closed) return;
    disposeSource();
    clearReconnect();
    onConnectionStateChange?.('connecting');
    recordConversationWatchConnectionState('connecting');

    try {
      source = new EventSource(buildConversationThreadWatchUrl(rootUri));
    } catch {
      recordConversationWatchStatus({ state: 'reconnect', code: 'eventsource_init_failed' });
      scheduleReconnect();
      return;
    }

    source.addEventListener('ready', () => {
      reconnectAttempt = 0;
      preferredReconnectDelayMs = undefined;
      onConnectionStateChange?.('ready');
      recordConversationWatchConnectionState('ready');
    });

    source.addEventListener('invalidation', (event) => {
      const parsed = normalizeConversationThreadInvalidationEvent(
        safeParseEventData((event as MessageEvent<string>).data),
      );
      if (!parsed || parsed.rootUri !== rootUri) return;
      reconnectAttempt = 0;
      preferredReconnectDelayMs = undefined;
      recordConversationWatchInvalidation(parsed.observedAt);
      onInvalidation(parsed);
    });

    source.addEventListener('status', (event) => {
      const parsed = normalizeConversationThreadStatusEvent(
        safeParseEventData((event as MessageEvent<string>).data),
      );
      if (!parsed || parsed.rootUri !== rootUri) return;
      preferredReconnectDelayMs = parsed.retryAfterMs;
      if (parsed.state === 'degraded') {
        recordConversationWatchStatus({ state: 'degraded', code: parsed.code });
      } else {
        recordConversationWatchStatus({ state: 'reconnect', code: parsed.code });
      }
    });

    source.onerror = () => {
      if (closed) return;
      disposeSource();
      recordConversationWatchStatus({ state: 'reconnect', code: 'eventsource_error' });
      scheduleReconnect();
    };
  };

  const handleOnline = () => {
    if (closed) return;
    reconnectAttempt = 0;
    preferredReconnectDelayMs = undefined;
    connect();
  };

  connect();
  window.addEventListener('online', handleOnline);

  return () => {
    closed = true;
    clearReconnect();
    window.removeEventListener('online', handleOnline);
    disposeSource();
    recordConversationWatchConnectionState('closed');
    onConnectionStateChange?.('closed');
  };
}
