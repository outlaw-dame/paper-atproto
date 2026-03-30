// ─── Session Store ─────────────────────────────────────────────────────────
// Owns all auth/session state. The Agent instance lives here so it is
// accessible to TanStack Query fetchers without needing a React context.
//
// Other stores and query hooks import `useSessionStore` to get the agent.

import { create } from 'zustand';
import { Agent } from '@atproto/api';
import type { AppBskyActorDefs } from '@atproto/api';

export interface SessionData {
  did: string;
  handle: string;
  email?: string;
  scope?: string;
  issuer?: string;
}

interface SessionState {
  agent: Agent;
  session: SessionData | null;
  /** True once the agent has had resumeSession/login complete — safe to make authed API calls */
  sessionReady: boolean;
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSession: (s: SessionData | null) => void;
  setSessionReady: (v: boolean) => void;
  setAgent: (a: Agent) => void;
  setProfile: (p: AppBskyActorDefs.ProfileViewDetailed | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  resetAgent: () => void;
}

function buildUnauthedAgent(): Agent {
  // Public AppView host for unauthenticated fetches prior to OAuth restore.
  return new Agent({ service: 'https://public.api.bsky.app' });
}

const LEGACY_SESSION_KEY = 'glimpse-session-v1';

// ─── Recent handles (login autocomplete) ────────────────────────────────────
const RECENT_HANDLES_KEY = 'glimpse:recent-handles';

export interface RecentHandle {
  handle: string;
  displayName?: string;
  avatar?: string;
}

export function getRecentHandles(): RecentHandle[] {
  try {
    const storage = getRecentHandleStorage();
    if (!storage) return [];
    const raw = storage.getItem(RECENT_HANDLES_KEY);
    return raw ? (JSON.parse(raw) as RecentHandle[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentHandle(account: RecentHandle): void {
  try {
    const storage = getRecentHandleStorage();
    if (!storage) return;
    const existing = getRecentHandles().filter((a) => a.handle !== account.handle);
    storage.setItem(
      RECENT_HANDLES_KEY,
      JSON.stringify([account, ...existing].slice(0, 5)),
    );
  } catch {
    // Storage unavailable — ignore silently.
  }
}

export function clearRecentHandles(): void {
  try {
    sessionStorage.removeItem(RECENT_HANDLES_KEY);
  } catch {
    // Ignore storage failures.
  }

  try {
    localStorage.removeItem(RECENT_HANDLES_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function getRecentHandleStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

export const useSessionStore = create<SessionState>((set, get) => {
  const agent = buildUnauthedAgent();

  // Cleanup legacy password-session state once at startup.
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Ignore storage failures (private browsing/quota constraints).
  }

  // Clear older persistent recent-account hints. We only keep recent handles
  // for the current browser session to avoid implicit long-term remembrance.
  try {
    localStorage.removeItem(RECENT_HANDLES_KEY);
  } catch {
    // Ignore storage failures.
  }

  return {
    agent,
    session: null,
    sessionReady: false,
    profile: null,
    isLoading: true,
    error: null,

    setSession: (s) => set({ session: s }),
    setSessionReady: (v) => set({ sessionReady: v }),
    setAgent: (a) => set({ agent: a }),
    setProfile: (p) => set({ profile: p }),
    setLoading: (v) => set({ isLoading: v }),
    setError: (msg) => set({ error: msg }),

    resetAgent: () => {
      const newAgent = buildUnauthedAgent();
      set({ agent: newAgent, session: null, sessionReady: false, profile: null });
    },
  };
});
