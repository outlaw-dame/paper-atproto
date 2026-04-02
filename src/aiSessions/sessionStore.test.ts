import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSessionId } from './sessionSchemas';
import { useAiSessionStore } from './sessionStore';

const CACHE_KEY = 'paper-ai-session-cache-v1';
const OWNER_A = 'did:plc:aaaaaaaaaaaaaaaa';
const OWNER_B = 'did:plc:bbbbbbbbbbbbbbbb';
const SESSION_ID = 'as_1234567890ab' as AiSessionId;

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function seedBootstrapEntry() {
  useAiSessionStore.getState().setBootstrap(SESSION_ID, {
    session: {
      id: SESSION_ID,
      type: 'thread_summary',
      privacyMode: 'private',
      scope: { rootUri: 'at://did:plc:root/app.bsky.feed.post/1' },
      lookupKey: 'thread-summary:at://did:plc:root/app.bsky.feed.post/1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    members: [
      {
        did: OWNER_A,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      },
    ],
    capabilities: {
      canWriteMessages: true,
      canTriggerGeneration: true,
      canInvite: false,
      canViewArtifacts: true,
      canWritePresence: true,
    },
    messageHistory: [],
    stateSnapshot: {
      artifacts: [],
      activeGeneration: null,
    },
    eventOffset: 0,
    stateOffset: 0,
    presenceOffset: 0,
    activeGenerationInProgress: false,
  });
}

describe('aiSessions sessionStore cache isolation', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    useAiSessionStore.getState().setCacheOwnerDid(null);
    useAiSessionStore.getState().clearCache();
    useAiSessionStore.setState({ byId: {} });
  });

  it('persists cache entries under the active owner DID envelope', () => {
    useAiSessionStore.getState().setCacheOwnerDid(OWNER_A);
    seedBootstrapEntry();

    const raw = localStorage.getItem(CACHE_KEY);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw ?? '{}') as {
      ownerDid?: string;
      entries?: Record<string, unknown>;
    };

    expect(parsed.ownerDid).toBe(OWNER_A);
    expect(parsed.entries).toBeTruthy();
    expect(Object.keys(parsed.entries ?? {})).toContain(SESSION_ID);
  });

  it('persists only minimal resumable metadata at rest', () => {
    useAiSessionStore.getState().setCacheOwnerDid(OWNER_A);
    seedBootstrapEntry();

    const raw = localStorage.getItem(CACHE_KEY);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw ?? '{}') as {
      entries?: Record<string, {
        messageHistory?: unknown[];
        recentStateEvents?: unknown[];
        recentPresenceEvents?: unknown[];
        stateSnapshot?: unknown;
      }>;
    };

    const persisted = parsed.entries?.[SESSION_ID];
    expect(persisted).toBeTruthy();
    expect(persisted?.messageHistory ?? []).toEqual([]);
    expect(persisted?.recentStateEvents ?? []).toEqual([]);
    expect(persisted?.recentPresenceEvents ?? []).toEqual([]);
    expect(persisted?.stateSnapshot).toBeUndefined();
  });

  it('does not hydrate entries for a different owner DID', () => {
    useAiSessionStore.getState().setCacheOwnerDid(OWNER_A);
    seedBootstrapEntry();
    expect(Object.keys(useAiSessionStore.getState().byId)).toContain(SESSION_ID);

    useAiSessionStore.getState().setCacheOwnerDid(OWNER_B);
    expect(Object.keys(useAiSessionStore.getState().byId)).toEqual([]);

    useAiSessionStore.getState().setCacheOwnerDid(OWNER_A);
    expect(Object.keys(useAiSessionStore.getState().byId)).toContain(SESSION_ID);
  });

  it('removes persisted cache when owner context is cleared', () => {
    useAiSessionStore.getState().setCacheOwnerDid(OWNER_A);
    seedBootstrapEntry();
    expect(localStorage.getItem(CACHE_KEY)).toBeTruthy();

    useAiSessionStore.getState().setCacheOwnerDid(null);
    useAiSessionStore.getState().clearCache();

    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(Object.keys(useAiSessionStore.getState().byId)).toEqual([]);
  });
});
