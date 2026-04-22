import { create } from 'zustand';
import type {
  AiSessionEvent,
  AiSessionId,
  PresenceEvent,
  SessionCapabilities,
  SessionMember,
  SessionMetadata,
  StateEvent,
} from './sessionSchemas';

type Offsets = {
  event: number;
  state: number;
  presence: number;
};

export type SessionCacheEntry = {
  sessionId: AiSessionId;
  session?: SessionMetadata;
  members: SessionMember[];
  capabilities?: SessionCapabilities;
  messageHistory: AiSessionEvent[];
  stateSnapshot?: {
    artifacts: unknown[];
    activeGeneration: unknown;
  };
  recentStateEvents: StateEvent[];
  recentPresenceEvents: PresenceEvent[];
  offsets: Offsets;
  activeGenerationInProgress: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  lastSyncedAt?: string;
};

type SessionStore = {
  cacheOwnerDid: string | null;
  byId: Record<string, SessionCacheEntry>;
  setCacheOwnerDid: (did: string | null) => void;
  clearCache: () => void;
  ensureEntry: (sessionId: AiSessionId) => void;
  setBootstrap: (
    sessionId: AiSessionId,
    data: {
      session: SessionMetadata;
      members: SessionMember[];
      capabilities: SessionCapabilities;
      messageHistory: AiSessionEvent[];
      stateSnapshot: { artifacts: unknown[]; activeGeneration: unknown };
      eventOffset: number;
      stateOffset: number;
      presenceOffset: number;
      activeGenerationInProgress: boolean;
    },
  ) => void;
  appendEvents: (sessionId: AiSessionId, events: AiSessionEvent[], nextOffset: number) => void;
  appendStateEvents: (sessionId: AiSessionId, events: StateEvent[], nextOffset: number) => void;
  appendPresenceEvents: (sessionId: AiSessionId, events: PresenceEvent[], nextOffset: number) => void;
  setStatus: (sessionId: AiSessionId, status: SessionCacheEntry['status'], error?: string) => void;
  setActiveGeneration: (sessionId: AiSessionId, inProgress: boolean) => void;
};

const CACHE_KEY = 'paper-ai-session-cache-v1';
const MAX_EVENT_HISTORY = 300;
const MAX_STATE_EVENTS = 200;
const MAX_PRESENCE_EVENTS = 200;
const MAX_CACHE_ENTRIES = 24;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const MINIMAL_PERSISTENCE_ENABLED = import.meta.env.VITE_AI_SESSION_MINIMAL_PERSISTENCE !== 'false';

type SessionCacheEnvelope = {
  ownerDid: string;
  savedAt: number;
  entries: Record<string, unknown>;
};

function parseIsoMs(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeOwnerDid(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase();
  return DID_PATTERN.test(cleaned) ? cleaned : null;
}

function normalizeOffsets(value: unknown): Offsets {
  const source = (value && typeof value === 'object') ? (value as Partial<Offsets>) : {};
  const event = Number.isFinite(source.event) ? Math.max(0, Math.floor(source.event as number)) : 0;
  const state = Number.isFinite(source.state) ? Math.max(0, Math.floor(source.state as number)) : 0;
  const presence = Number.isFinite(source.presence) ? Math.max(0, Math.floor(source.presence as number)) : 0;
  return { event, state, presence };
}

function normalizeEntry(value: unknown, sessionId: AiSessionId): SessionCacheEntry {
  const source = (value && typeof value === 'object') ? (value as Partial<SessionCacheEntry>) : {};
  return {
    sessionId,
    ...(source.session ? { session: source.session } : {}),
    members: Array.isArray(source.members) ? source.members : [],
    ...(source.capabilities ? { capabilities: source.capabilities } : {}),
    messageHistory: Array.isArray(source.messageHistory) ? source.messageHistory.slice(-MAX_EVENT_HISTORY) : [],
    ...(source.stateSnapshot ? { stateSnapshot: source.stateSnapshot } : {}),
    recentStateEvents: Array.isArray(source.recentStateEvents) ? source.recentStateEvents.slice(-MAX_STATE_EVENTS) : [],
    recentPresenceEvents: Array.isArray(source.recentPresenceEvents) ? source.recentPresenceEvents.slice(-MAX_PRESENCE_EVENTS) : [],
    offsets: normalizeOffsets(source.offsets),
    activeGenerationInProgress: source.activeGenerationInProgress === true,
    status: source.status === 'loading' || source.status === 'ready' || source.status === 'error' ? source.status : 'idle',
    ...(typeof source.error === 'string' && source.error ? { error: source.error } : {}),
    ...(typeof source.lastSyncedAt === 'string' ? { lastSyncedAt: source.lastSyncedAt } : {}),
  };
}

function sortByFreshnessDesc(
  entries: Array<{ key: string; entry: SessionCacheEntry; syncedAtMs: number }>,
): Array<{ key: string; entry: SessionCacheEntry; syncedAtMs: number }> {
  return entries.sort((a, b) => b.syncedAtMs - a.syncedAtMs);
}

function emptyEntry(sessionId: AiSessionId): SessionCacheEntry {
  return {
    sessionId,
    members: [],
    messageHistory: [],
    recentStateEvents: [],
    recentPresenceEvents: [],
    offsets: {
      event: 0,
      state: 0,
      presence: 0,
    },
    activeGenerationInProgress: false,
    status: 'idle',
  };
}

function toPersistedEntry(entry: SessionCacheEntry): SessionCacheEntry {
  if (MINIMAL_PERSISTENCE_ENABLED) {
    const {
      capabilities: _capabilities,
      stateSnapshot: _stateSnapshot,
      error: _error,
      ...safeBase
    } = entry;
    return {
      ...safeBase,
      members: [],
      messageHistory: [],
      recentStateEvents: [],
      recentPresenceEvents: [],
    };
  }

  return {
    ...entry,
    messageHistory: entry.messageHistory.slice(-MAX_EVENT_HISTORY),
    recentStateEvents: entry.recentStateEvents.slice(-MAX_STATE_EVENTS),
    recentPresenceEvents: entry.recentPresenceEvents.slice(-MAX_PRESENCE_EVENTS),
  };
}

function safeLoadCache(ownerDid: string | null): Record<string, SessionCacheEntry> {
  if (typeof window === 'undefined') return {};
  if (!ownerDid) return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SessionCacheEnvelope>;
    if (!parsed || typeof parsed !== 'object') return {};
    if (typeof parsed.ownerDid !== 'string') return {};
    if (normalizeOwnerDid(parsed.ownerDid) !== ownerDid) return {};
    const entries = parsed.entries;
    if (!entries || typeof entries !== 'object') return {};

    const now = Date.now();
    const hydrated = Object.entries(entries)
      .flatMap(([key, value]) => {
        if (typeof key !== 'string' || key.length < 4) return [];
        const candidate = value as Partial<SessionCacheEntry>;
        if (!candidate || typeof candidate !== 'object') return [];
        if (typeof candidate.sessionId !== 'string' || candidate.sessionId !== key) return [];
        const syncedAtMs = parseIsoMs(candidate.lastSyncedAt);
        if (syncedAtMs <= 0) return [];
        if (now - syncedAtMs > CACHE_MAX_AGE_MS) return [];
        return [{
          key,
          entry: normalizeEntry(candidate, key as AiSessionId),
          syncedAtMs,
        }];
      });

    const bounded = sortByFreshnessDesc(hydrated).slice(0, MAX_CACHE_ENTRIES);
    return bounded.reduce<Record<string, SessionCacheEntry>>((acc, item) => {
      acc[item.key] = item.entry;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function safeSaveCache(byId: Record<string, SessionCacheEntry>, ownerDid: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ownerDid) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }

    const compactedEntries = sortByFreshnessDesc(
      Object.entries(byId).map(([key, value]) => ({
        key,
        entry: toPersistedEntry(value),
        syncedAtMs: parseIsoMs(value.lastSyncedAt),
      })),
    ).slice(0, MAX_CACHE_ENTRIES);

    const compacted = compactedEntries.reduce<Record<string, SessionCacheEntry>>((acc, item) => {
      acc[item.key] = item.entry;
      return acc;
    }, {});

    if (!Object.keys(compacted).length) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }

    const envelope: SessionCacheEnvelope = {
      ownerDid,
      savedAt: Date.now(),
      entries: compacted,
    };

    window.localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignore storage write failures (private mode/quota issues).
  }
}

export const useAiSessionStore = create<SessionStore>((set, get) => ({
  cacheOwnerDid: null,
  byId: {},
  setCacheOwnerDid: (did) => {
    const normalizedDid = normalizeOwnerDid(did);
    set((state) => {
      if (state.cacheOwnerDid === normalizedDid) return state;
      return {
        cacheOwnerDid: normalizedDid,
        byId: safeLoadCache(normalizedDid),
      };
    });
  },
  clearCache: () => {
    set((state) => {
      safeSaveCache({}, state.cacheOwnerDid);
      return { byId: {} };
    });
  },
  ensureEntry: (sessionId) => {
    set((state) => {
      if (state.byId[sessionId]) return state;
      const next = {
        ...state.byId,
        [sessionId]: emptyEntry(sessionId),
      };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  setBootstrap: (sessionId, data) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const { error: _previousError, ...currentWithoutError } = current;
      const nextEntry: SessionCacheEntry = {
        ...currentWithoutError,
        session: data.session,
        members: data.members,
        capabilities: data.capabilities,
        messageHistory: data.messageHistory.slice(-MAX_EVENT_HISTORY),
        stateSnapshot: data.stateSnapshot,
        offsets: {
          event: data.eventOffset,
          state: data.stateOffset,
          presence: data.presenceOffset,
        },
        activeGenerationInProgress: data.activeGenerationInProgress,
        status: 'ready',
        lastSyncedAt: new Date().toISOString(),
      };
      const next = {
        ...state.byId,
        [sessionId]: nextEntry,
      };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  appendEvents: (sessionId, events, nextOffset) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const history = [...current.messageHistory, ...events]
        .filter((event) => event.kind === 'message.user' || event.kind === 'message.assistant')
        .slice(-MAX_EVENT_HISTORY);
      const nextEntry: SessionCacheEntry = {
        ...current,
        messageHistory: history,
        offsets: {
          ...current.offsets,
          event: nextOffset,
        },
        lastSyncedAt: new Date().toISOString(),
      };
      const next = { ...state.byId, [sessionId]: nextEntry };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  appendStateEvents: (sessionId, events, nextOffset) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const recentStateEvents = [...current.recentStateEvents, ...events].slice(-MAX_STATE_EVENTS);
      const nextEntry: SessionCacheEntry = {
        ...current,
        recentStateEvents,
        offsets: {
          ...current.offsets,
          state: nextOffset,
        },
        lastSyncedAt: new Date().toISOString(),
      };
      const next = { ...state.byId, [sessionId]: nextEntry };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  appendPresenceEvents: (sessionId, events, nextOffset) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const recentPresenceEvents = [...current.recentPresenceEvents, ...events].slice(-MAX_PRESENCE_EVENTS);
      const nextEntry: SessionCacheEntry = {
        ...current,
        recentPresenceEvents,
        offsets: {
          ...current.offsets,
          presence: nextOffset,
        },
        lastSyncedAt: new Date().toISOString(),
      };
      const next = { ...state.byId, [sessionId]: nextEntry };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  setStatus: (sessionId, status, error) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const { error: _previousError, ...currentWithoutError } = current;
      const nextEntry: SessionCacheEntry = {
        ...currentWithoutError,
        status,
        ...(error ? { error } : {}),
      };
      const next = {
        ...state.byId,
        [sessionId]: nextEntry,
      };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
  setActiveGeneration: (sessionId, inProgress) => {
    set((state) => {
      const current = state.byId[sessionId] ?? emptyEntry(sessionId);
      const nextEntry: SessionCacheEntry = {
        ...current,
        activeGenerationInProgress: inProgress,
      };
      const next = {
        ...state.byId,
        [sessionId]: nextEntry,
      };
      safeSaveCache(next, state.cacheOwnerDid);
      return { byId: next };
    });
  },
}));

export function getSessionEntry(sessionId: AiSessionId): SessionCacheEntry | null {
  return useAiSessionStore.getState().byId[sessionId] ?? null;
}
