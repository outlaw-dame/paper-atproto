// ─── Session Store ─────────────────────────────────────────────────────────
// Owns all auth/session state. The BskyAgent instance lives here so it is
// accessible to TanStack Query fetchers without needing a React context.
//
// Other stores and query hooks import `useSessionStore` to get the agent.

import { create } from 'zustand';
import { BskyAgent } from '@atproto/api';
import type { AppBskyActorDefs } from '@atproto/api';

export interface SessionData {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  email?: string;
}

interface SessionState {
  agent: BskyAgent;
  session: SessionData | null;
  /** True once the agent has had resumeSession/login complete — safe to make authed API calls */
  sessionReady: boolean;
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSession: (s: SessionData | null) => void;
  setSessionReady: (v: boolean) => void;
  setProfile: (p: AppBskyActorDefs.ProfileViewDetailed | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  resetAgent: () => void;
}

const SESSION_KEY = 'glimpse-session-v1';

function buildAgent(onSession: (s: SessionData | null) => void): BskyAgent {
  return new BskyAgent({
    service: 'https://bsky.social',
    persistSession: (evt, sess) => {
      try {
        if ((evt === 'create' || evt === 'update') && sess) {
          const s: SessionData = {
            did: sess.did,
            handle: sess.handle,
            accessJwt: sess.accessJwt,
            refreshJwt: sess.refreshJwt,
            email: sess.email ?? undefined,
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(s));
          onSession(s);
        } else if (evt === 'expired' || evt === 'create-failed') {
          localStorage.removeItem(SESSION_KEY);
          onSession(null);
        }
      } catch (err) {
        console.error('[Session] Failed to persist session:', err);
        // Session persistence failed but session is still valid in memory
      }
    },
  });
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Build the initial agent; its persistSession callback writes back into the store
  const agent = buildAgent((s) => get().setSession(s));

  return {
    agent,
    session: null,
    sessionReady: false,
    profile: null,
    isLoading: true,
    error: null,

    setSession: (s) => set({ session: s }),
    setSessionReady: (v) => set({ sessionReady: v }),
    setProfile: (p) => set({ profile: p }),
    setLoading: (v) => set({ isLoading: v }),
    setError: (msg) => set({ error: msg }),

    resetAgent: () => {
      const newAgent = buildAgent((s) => get().setSession(s));
      set({ agent: newAgent, session: null, sessionReady: false, profile: null });
    },
  };
});

export { SESSION_KEY };
