// ─── ATProto Context ───────────────────────────────────────────────────────
// Thin React context that:
//   1. Bootstraps the Zustand sessionStore on mount (restores persisted session)
//   2. Exposes login / logout actions to React components
//   3. Provides the same useAtp() hook API as before so existing components
//      don't need to change their imports
//
// The BskyAgent instance and session state now live in sessionStore so they
// are accessible to TanStack Query fetchers outside the React tree.

import React, { createContext, useContext, useEffect, useCallback } from 'react';
import type { AppBskyActorDefs } from '@atproto/api';
import { useSessionStore, SESSION_KEY, type SessionData } from '../store/sessionStore.js';
import { atpCall } from '../lib/atproto/client.js';

// ─── Public context shape ──────────────────────────────────────────────────
export interface AtpContextValue {
  session: SessionData | null;
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  isLoading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Direct agent access for one-off calls that aren't worth a query hook */
  agent: ReturnType<typeof useSessionStore>['agent'];
}

const AtpContext = createContext<AtpContextValue | null>(null);

export function useAtp(): AtpContextValue {
  const ctx = useContext(AtpContext);
  if (!ctx) throw new Error('useAtp must be used inside <AtpProvider>');
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────
export function AtpProvider({ children }: { children: React.ReactNode }) {
  const {
    agent,
    session, setSession,
    profile, setProfile,
    isLoading, setLoading,
    error, setError,
    setSessionReady,
    resetAgent,
  } = useSessionStore();

  // Fetch and cache the full profile for the signed-in user
  const fetchProfile = useCallback(async (did: string) => {
    try {
      const res = await atpCall(s => agent.getProfile({ actor: did }));
      setProfile(res.data);
    } catch {
      // Non-fatal — profile is cosmetic
    }
  }, [agent, setProfile]);

  // Restore persisted session on first mount
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) { setLoading(false); return; }

    let saved: SessionData;
    try { saved = JSON.parse(stored); } catch {
      localStorage.removeItem(SESSION_KEY);
      setLoading(false);
      return;
    }

    // Optimistically show the UI immediately — no waiting for network
    setSession(saved);
    setLoading(false);

    // Verify / refresh the session in the background with a hard timeout
    const TIMEOUT_MS = 10_000;
    const raceTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session-restore-timeout')), TIMEOUT_MS)
    );

    Promise.race([
      agent.resumeSession({
        did: saved.did,
        handle: saved.handle,
        accessJwt: saved.accessJwt,
        refreshJwt: saved.refreshJwt,
        active: true,
      }),
      raceTimeout,
    ]).then(() => {
      setSessionReady(true);
      fetchProfile(saved.did);
    }).catch(() => {
      // Either invalid tokens or unreachable — keep the session so the app
      // stays usable offline; next API call will surface the real error.
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await agent.login({ identifier, password });
      const s: SessionData = {
        did: res.data.did,
        handle: res.data.handle,
        accessJwt: res.data.accessJwt,
        refreshJwt: res.data.refreshJwt,
        email: res.data.email ?? undefined,
      };
      setSession(s);
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSessionReady(true);
      await fetchProfile(s.did);
    } catch (err: unknown) {
      const msg = (err as any)?.message ?? 'Login failed';
      setError(
        msg.includes('Invalid') || msg.includes('AuthenticationRequired')
          ? 'Incorrect handle or app password. Please try again.'
          : msg
      );
      throw err;
    } finally {
      setLoading(false);
    }
  }, [agent, fetchProfile, setError, setLoading, setSession, setSessionReady]);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { await agent.logout(); } catch { /* ignore */ }
    localStorage.removeItem(SESSION_KEY);
    resetAgent();
  }, [agent, resetAgent]);

  return (
    <AtpContext.Provider value={{ agent, session, profile, isLoading, error, login, logout }}>
      {children}
    </AtpContext.Provider>
  );
}
