import { isAtUri } from '../lib/resolver/atproto';

const HYDRATION_INVALIDATION_CHANNEL = 'glympse-conversation-hydration';
const MAX_EVENT_AGE_MS = 60_000;

export type ConversationHydrationInvalidationReason =
  | 'remote_thread_changed'
  | 'optimistic_reply_inserted'
  | 'optimistic_reply_reconciled'
  | 'optimistic_reply_rolled_back';

export interface ConversationHydrationInvalidationEvent {
  sessionId: string;
  rootUri: string;
  reason: ConversationHydrationInvalidationReason;
  revision?: number;
  emittedAt: string;
  sourceId: string;
}

type ConversationHydrationInvalidationListener = (
  event: ConversationHydrationInvalidationEvent,
) => void;

type ConversationHydrationInvalidationFilter = {
  sessionId?: string;
  rootUri?: string;
};

const localSourceId = `hydration-${Math.random().toString(36).slice(2, 12)}`;
const listeners = new Set<ConversationHydrationInvalidationListener>();
let broadcastChannel: BroadcastChannel | null = null;
let broadcastChannelInitialized = false;

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeRevision(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.trunc(numeric);
}

function normalizeEvent(
  value: Partial<ConversationHydrationInvalidationEvent>,
): ConversationHydrationInvalidationEvent | null {
  const sessionId = normalizeBoundedString(value.sessionId, 320);
  const rootUri = normalizeBoundedString(value.rootUri, 320);
  const emittedAt = normalizeBoundedString(value.emittedAt, 64) ?? new Date().toISOString();
  const sourceId = normalizeBoundedString(value.sourceId, 64) ?? localSourceId;
  const revision = normalizeRevision(value.revision);

  if (!sessionId || !rootUri || !isAtUri(rootUri)) return null;
  if (
    value.reason !== 'remote_thread_changed'
    && value.reason !== 'optimistic_reply_inserted'
    && value.reason !== 'optimistic_reply_reconciled'
    && value.reason !== 'optimistic_reply_rolled_back'
  ) {
    return null;
  }

  const emittedAtMs = Date.parse(emittedAt);
  if (Number.isFinite(emittedAtMs) && Date.now() - emittedAtMs > MAX_EVENT_AGE_MS) {
    return null;
  }

  return {
    sessionId,
    rootUri,
    reason: value.reason,
    ...(revision !== undefined
      ? { revision }
      : {}),
    emittedAt,
    sourceId,
  };
}

function deliver(event: ConversationHydrationInvalidationEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Listener failures must never break hydration invalidation delivery.
    }
  });
}

function ensureBroadcastChannel(): void {
  if (broadcastChannelInitialized || typeof BroadcastChannel === 'undefined') return;
  broadcastChannelInitialized = true;

  try {
    broadcastChannel = new BroadcastChannel(HYDRATION_INVALIDATION_CHANNEL);
    broadcastChannel.addEventListener('message', (messageEvent) => {
      const event = normalizeEvent(
        messageEvent.data as Partial<ConversationHydrationInvalidationEvent>,
      );
      if (!event || event.sourceId === localSourceId) return;
      deliver(event);
    });
  } catch {
    broadcastChannel = null;
  }
}

export function emitConversationHydrationInvalidation(
  value: Omit<ConversationHydrationInvalidationEvent, 'emittedAt' | 'sourceId'> & {
    emittedAt?: string;
  },
): void {
  const event = normalizeEvent({
    ...value,
    emittedAt: value.emittedAt ?? new Date().toISOString(),
    sourceId: localSourceId,
  });
  if (!event) return;

  ensureBroadcastChannel();
  deliver(event);

  try {
    broadcastChannel?.postMessage(event);
  } catch {
    // Cross-tab broadcast is best-effort.
  }
}

export function subscribeConversationHydrationInvalidations(
  filter: ConversationHydrationInvalidationFilter,
  listener: ConversationHydrationInvalidationListener,
): () => void {
  ensureBroadcastChannel();

  const wrapped: ConversationHydrationInvalidationListener = (event) => {
    if (filter.sessionId && event.sessionId !== filter.sessionId) return;
    if (filter.rootUri && event.rootUri !== filter.rootUri) return;
    listener(event);
  };

  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

export function shouldSelfHealConversationHydration(params: {
  mutationRevision: number;
  lastHandledMutationRevision: number;
  lastMutationAt?: string | undefined;
  lastHydratedAt?: string | undefined;
}): boolean {
  const {
    mutationRevision,
    lastHandledMutationRevision,
    lastMutationAt,
    lastHydratedAt,
  } = params;

  if (!Number.isFinite(mutationRevision) || mutationRevision <= lastHandledMutationRevision) {
    return false;
  }

  const mutationMs = typeof lastMutationAt === 'string' ? Date.parse(lastMutationAt) : Number.NaN;
  const hydratedMs = typeof lastHydratedAt === 'string' ? Date.parse(lastHydratedAt) : Number.NaN;

  if (!Number.isFinite(mutationMs)) {
    return true;
  }
  if (!Number.isFinite(hydratedMs)) {
    return true;
  }

  return mutationMs > hydratedMs;
}

export function resetConversationHydrationInvalidationForTests(): void {
  listeners.clear();
  try {
    broadcastChannel?.close();
  } catch {
    // best-effort test cleanup
  }
  broadcastChannel = null;
  broadcastChannelInitialized = false;
}
