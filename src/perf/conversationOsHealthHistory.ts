import type { InterpolatorMetricsSnapshot } from './interpolatorTelemetry';

export interface ConversationOsHealthHistoryEntry {
  recordedAt: string;
  delta: {
    resolutionCount: number;
    storedReuseCount: number;
    rebuiltCount: number;
    selfHealCount: number;
    summaryFallbackCount: number;
  };
  watch: {
    currentState: InterpolatorMetricsSnapshot['watch']['currentState'];
    connectionAttempts: number;
    readyCount: number;
    invalidationCount: number;
    degradedCount: number;
    reconnectCount: number;
    closedCount: number;
  };
  hydration: {
    totalAttempts: number;
    totalSuccesses: number;
    totalFailures: number;
    eventShare: number;
    pollShare: number;
  };
  modes: Record<'normal' | 'descriptive_fallback' | 'minimal_fallback', number>;
}

const STORAGE_KEY = 'glympse:conversation-os-health-history:v1';
const MAX_ENTRIES = 180;
const MIN_SAMPLE_INTERVAL_MS = 60_000;
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60_000;
const VALID_WATCH_STATES = new Set<ConversationOsHealthHistoryEntry['watch']['currentState']>([
  'idle',
  'connecting',
  'ready',
  'retrying',
  'closed',
]);

function clampCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function clampRate(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeWatchState(value: unknown): ConversationOsHealthHistoryEntry['watch']['currentState'] {
  return typeof value === 'string' && VALID_WATCH_STATES.has(value as ConversationOsHealthHistoryEntry['watch']['currentState'])
    ? value as ConversationOsHealthHistoryEntry['watch']['currentState']
    : 'idle';
}

function normalizeEntry(input: unknown, nowMs: number): ConversationOsHealthHistoryEntry | null {
  if (typeof input !== 'object' || input === null) return null;
  const candidate = input as Partial<ConversationOsHealthHistoryEntry>;
  const recordedAt = normalizeIsoTimestamp(candidate.recordedAt);
  if (!recordedAt) return null;
  if ((nowMs - Date.parse(recordedAt)) > MAX_ENTRY_AGE_MS) return null;

  return {
    recordedAt,
    delta: {
      resolutionCount: clampCount(candidate.delta?.resolutionCount),
      storedReuseCount: clampCount(candidate.delta?.storedReuseCount),
      rebuiltCount: clampCount(candidate.delta?.rebuiltCount),
      selfHealCount: clampCount(candidate.delta?.selfHealCount),
      summaryFallbackCount: clampCount(candidate.delta?.summaryFallbackCount),
    },
    watch: {
      currentState: normalizeWatchState(candidate.watch?.currentState),
      connectionAttempts: clampCount(candidate.watch?.connectionAttempts),
      readyCount: clampCount(candidate.watch?.readyCount),
      invalidationCount: clampCount(candidate.watch?.invalidationCount),
      degradedCount: clampCount(candidate.watch?.degradedCount),
      reconnectCount: clampCount(candidate.watch?.reconnectCount),
      closedCount: clampCount(candidate.watch?.closedCount),
    },
    hydration: {
      totalAttempts: clampCount(candidate.hydration?.totalAttempts),
      totalSuccesses: clampCount(candidate.hydration?.totalSuccesses),
      totalFailures: clampCount(candidate.hydration?.totalFailures),
      eventShare: clampRate(candidate.hydration?.eventShare),
      pollShare: clampRate(candidate.hydration?.pollShare),
    },
    modes: {
      normal: clampCount(candidate.modes?.normal),
      descriptive_fallback: clampCount(candidate.modes?.descriptive_fallback),
      minimal_fallback: clampCount(candidate.modes?.minimal_fallback),
    },
  };
}

function getStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitizeHistory(entries: unknown, nowMs = Date.now()): ConversationOsHealthHistoryEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => normalizeEntry(entry, nowMs))
    .filter((entry): entry is ConversationOsHealthHistoryEntry => entry !== null)
    .slice(-MAX_ENTRIES);
}

function serializeEntry(snapshot: InterpolatorMetricsSnapshot, recordedAt: string): ConversationOsHealthHistoryEntry {
  return {
    recordedAt,
    delta: {
      resolutionCount: clampCount(snapshot.delta.resolutionCount),
      storedReuseCount: clampCount(snapshot.delta.storedReuseCount),
      rebuiltCount: clampCount(snapshot.delta.rebuiltCount),
      selfHealCount: clampCount(snapshot.delta.selfHealCount),
      summaryFallbackCount: clampCount(snapshot.delta.summaryFallbackCount),
    },
    watch: {
      currentState: snapshot.watch.currentState,
      connectionAttempts: clampCount(snapshot.watch.connectionAttempts),
      readyCount: clampCount(snapshot.watch.readyCount),
      invalidationCount: clampCount(snapshot.watch.invalidationCount),
      degradedCount: clampCount(snapshot.watch.degradedCount),
      reconnectCount: clampCount(snapshot.watch.reconnectCount),
      closedCount: clampCount(snapshot.watch.closedCount),
    },
    hydration: {
      totalAttempts: clampCount(snapshot.hydration.totalAttempts),
      totalSuccesses: clampCount(snapshot.hydration.totalSuccesses),
      totalFailures: clampCount(snapshot.hydration.totalFailures),
      eventShare: clampRate(snapshot.hydration.eventShare),
      pollShare: clampRate(snapshot.hydration.pollShare),
    },
    modes: {
      normal: clampCount(snapshot.modes.normal.count),
      descriptive_fallback: clampCount(snapshot.modes.descriptive_fallback.count),
      minimal_fallback: clampCount(snapshot.modes.minimal_fallback.count),
    },
  };
}

function areEntriesEquivalent(
  left: ConversationOsHealthHistoryEntry | undefined,
  right: ConversationOsHealthHistoryEntry,
): boolean {
  if (!left) return false;
  return JSON.stringify({ ...left, recordedAt: undefined }) === JSON.stringify({ ...right, recordedAt: undefined });
}

export function readConversationOsHealthHistory(storage?: Storage | null): ConversationOsHealthHistoryEntry[] {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return [];

  try {
    const raw = resolvedStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function appendConversationOsHealthHistory(
  snapshot: InterpolatorMetricsSnapshot,
  options?: {
    storage?: Storage | null;
    recordedAt?: string;
    minSampleIntervalMs?: number;
  },
): ConversationOsHealthHistoryEntry[] {
  const resolvedStorage = getStorage(options?.storage);
  const recordedAt = normalizeIsoTimestamp(options?.recordedAt) ?? new Date().toISOString();
  const nextEntry = serializeEntry(snapshot, recordedAt);
  const current = readConversationOsHealthHistory(resolvedStorage);
  const nextHistory = [...current];
  const lastEntry = nextHistory.at(-1);
  const minSampleIntervalMs = options?.minSampleIntervalMs ?? MIN_SAMPLE_INTERVAL_MS;
  const lastRecordedAtMs = lastEntry ? Date.parse(lastEntry.recordedAt) : 0;
  const nextRecordedAtMs = Date.parse(recordedAt);

  if (areEntriesEquivalent(lastEntry, nextEntry)) {
    return current;
  }

  if (lastEntry && (nextRecordedAtMs - lastRecordedAtMs) < minSampleIntervalMs) {
    nextHistory[nextHistory.length - 1] = nextEntry;
  } else {
    nextHistory.push(nextEntry);
  }

  const sanitized = sanitizeHistory(nextHistory, nextRecordedAtMs);

  if (!resolvedStorage) return sanitized;

  try {
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // best-effort persistence only
  }

  return sanitized;
}

export function clearConversationOsHealthHistory(storage?: Storage | null): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only
  }
}
