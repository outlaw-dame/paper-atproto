import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { BskyAgent } from '@atproto/api';
import type { AppBskyActorDefs } from '@atproto/api';

// ─── Types ─────────────────────────────────────────────────────────────────
export interface AtpSession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  email?: string | undefined;
}

export interface AtpContextValue {
  agent: BskyAgent;
  session: AtpSession | null;
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  isLoading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ─── Storage key ───────────────────────────────────────────────────────────
const SESSION_KEY = 'paper-atproto-session';

// ─── Context ───────────────────────────────────────────────────────────────
const AtpContext = createContext<AtpContextValue | null>(null);

export function useAtp(): AtpContextValue {
  const ctx = useContext(AtpContext);
  if (!ctx) throw new Error('useAtp must be used inside <AtpProvider>');
  return ctx;
}

// ─── Create a fresh agent with session persistence wired in ────────────────
function createAgent(
  onSessionChange: (session: AtpSession | null) => void
): BskyAgent {
  return new BskyAgent({
    service: 'https://bsky.social',
    persistSession: (evt, sess) => {
      if ((evt === 'create' || evt === 'update') && sess) {
        const s: AtpSession = {
          did: sess.did,
          handle: sess.handle,
          accessJwt: sess.accessJwt,
          refreshJwt: sess.refreshJwt,
          email: sess.email ?? undefined,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        onSessionChange(s);
      } else if (evt === 'expired' || evt === 'create-failed') {
        localStorage.removeItem(SESSION_KEY);
        onSessionChange(null);
      }
    },
  });
}

// ─── Provider ──────────────────────────────────────────────────────────────
export function AtpProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AtpSession | null>(null);
  const [profile, setProfile] = useState<AppBskyActorDefs.ProfileViewDetailed | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create agent once; the persistSession callback captures setSession via ref
  const sessionRef = useRef<((s: AtpSession | null) => void)>(setSession);
  sessionRef.current = setSession;

  const agentRef = useRef<BskyAgent>(
    createAgent((s) => sessionRef.current(s))
  );
  const agent = agentRef.current;

  // Fetch and cache the profile for the current session
  const fetchProfile = useCallback(async (did: string) => {
    try {
      const res = await agent.getProfile({ actor: did });
      setProfile(res.data);
    } catch {
      // Non-fatal
    }
  }, [agent]);

  // Restore persisted session on mount
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) { setIsLoading(false); return; }
    try {
      const saved: AtpSession = JSON.parse(stored);
      agent.resumeSession({
        did: saved.did,
        handle: saved.handle,
        accessJwt: saved.accessJwt,
        refreshJwt: saved.refreshJwt,
        active: true,
      }).then(() => {
        setSession(saved);
        fetchProfile(saved.did);
      }).catch(() => {
        localStorage.removeItem(SESSION_KEY);
      }).finally(() => setIsLoading(false));
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setIsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await agent.login({ identifier, password });
      const s: AtpSession = {
        did: res.data.did,
        handle: res.data.handle,
        accessJwt: res.data.accessJwt,
        refreshJwt: res.data.refreshJwt,
        email: res.data.email ?? undefined,
      };
      setSession(s);
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
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
      setIsLoading(false);
    }
  }, [agent, fetchProfile]);

  const logout = useCallback(async () => {
    try { await agent.logout(); } catch { /* ignore */ }
    setSession(null);
    setProfile(null);
    localStorage.removeItem(SESSION_KEY);
    // Replace agent with a fresh one
    agentRef.current = createAgent((s) => sessionRef.current(s));
  }, [agent]);

  return (
    <AtpContext.Provider value={{ agent, session, profile, isLoading, error, login, logout }}>
      {children}
    </AtpContext.Provider>
  );
}
