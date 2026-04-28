export interface WriterEnhancerProviderHistorySnapshot {
  enhancer?: {
    providers?: Record<string, {
      reviews?: number;
      failures?: number;
      appliedTakeovers?: {
        candidate?: number;
        rescue?: number;
      };
      latencyMs?: {
        total?: number;
      };
    }>;
  };
}

export interface WriterEnhancerProviderHistoryEntry {
  recordedAt: string;
  providers: Record<'gemini' | 'openai', {
    reviews: number;
    failures: number;
    candidateTakeovers: number;
    rescueTakeovers: number;
    latencyTotalMs: number;
  }>;
}

const STORAGE_KEY = 'glympse:writer-enhancer-provider-history:v1';
const MAX_ENTRIES = 180;
const MIN_SAMPLE_INTERVAL_MS = 60_000;
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60_000;
function clampCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
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

function normalizeEntry(input: unknown, nowMs: number): WriterEnhancerProviderHistoryEntry | null {
  if (typeof input !== 'object' || input === null) return null;
  const candidate = input as Partial<WriterEnhancerProviderHistoryEntry>;
  const recordedAt = normalizeIsoTimestamp(candidate.recordedAt);
  if (!recordedAt) return null;
  if ((nowMs - Date.parse(recordedAt)) > MAX_ENTRY_AGE_MS) return null;

  return {
    recordedAt,
    providers: {
      gemini: {
        reviews: clampCount(candidate.providers?.gemini?.reviews),
        failures: clampCount(candidate.providers?.gemini?.failures),
        candidateTakeovers: clampCount(candidate.providers?.gemini?.candidateTakeovers),
        rescueTakeovers: clampCount(candidate.providers?.gemini?.rescueTakeovers),
        latencyTotalMs: clampCount(candidate.providers?.gemini?.latencyTotalMs),
      },
      openai: {
        reviews: clampCount(candidate.providers?.openai?.reviews),
        failures: clampCount(candidate.providers?.openai?.failures),
        candidateTakeovers: clampCount(candidate.providers?.openai?.candidateTakeovers),
        rescueTakeovers: clampCount(candidate.providers?.openai?.rescueTakeovers),
        latencyTotalMs: clampCount(candidate.providers?.openai?.latencyTotalMs),
      },
    },
  };
}

function sanitizeHistory(entries: unknown, nowMs = Date.now()): WriterEnhancerProviderHistoryEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => normalizeEntry(entry, nowMs))
    .filter((entry): entry is WriterEnhancerProviderHistoryEntry => entry !== null)
    .slice(-MAX_ENTRIES);
}

function serializeEntry(
  snapshot: WriterEnhancerProviderHistorySnapshot,
  recordedAt: string,
): WriterEnhancerProviderHistoryEntry {
  const providers = snapshot.enhancer?.providers ?? {};

  return {
    recordedAt,
    providers: {
      gemini: {
        reviews: clampCount(providers.gemini?.reviews),
        failures: clampCount(providers.gemini?.failures),
        candidateTakeovers: clampCount(providers.gemini?.appliedTakeovers?.candidate),
        rescueTakeovers: clampCount(providers.gemini?.appliedTakeovers?.rescue),
        latencyTotalMs: clampCount(providers.gemini?.latencyMs?.total),
      },
      openai: {
        reviews: clampCount(providers.openai?.reviews),
        failures: clampCount(providers.openai?.failures),
        candidateTakeovers: clampCount(providers.openai?.appliedTakeovers?.candidate),
        rescueTakeovers: clampCount(providers.openai?.appliedTakeovers?.rescue),
        latencyTotalMs: clampCount(providers.openai?.latencyMs?.total),
      },
    },
  };
}

function areEntriesEquivalent(
  left: WriterEnhancerProviderHistoryEntry | undefined,
  right: WriterEnhancerProviderHistoryEntry,
): boolean {
  if (!left) return false;
  return JSON.stringify({ ...left, recordedAt: undefined }) === JSON.stringify({ ...right, recordedAt: undefined });
}

export function readWriterEnhancerProviderHistory(storage?: Storage | null): WriterEnhancerProviderHistoryEntry[] {
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

export function appendWriterEnhancerProviderHistory(
  snapshot: WriterEnhancerProviderHistorySnapshot,
  options?: {
    storage?: Storage | null;
    recordedAt?: string;
    minSampleIntervalMs?: number;
  },
): WriterEnhancerProviderHistoryEntry[] {
  const resolvedStorage = getStorage(options?.storage);
  const recordedAt = normalizeIsoTimestamp(options?.recordedAt) ?? new Date().toISOString();
  const nextEntry = serializeEntry(snapshot, recordedAt);
  const current = readWriterEnhancerProviderHistory(resolvedStorage);
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

export function clearWriterEnhancerProviderHistory(storage?: Storage | null): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only
  }
}
