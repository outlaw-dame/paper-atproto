// ─── ATProto Context ───────────────────────────────────────────────────────
// Thin React context that:
//   1. Bootstraps OAuth session restore/callback handling on mount
//   2. Exposes login / logout actions to React components
//   3. Provides the same useAtp() hook API as before so existing components
//      don't need to change their imports
//
// The Agent instance and session state now live in sessionStore so they
// are accessible to TanStack Query fetchers outside the React tree.

import React, { createContext, useContext, useEffect, useCallback } from 'react';
import { Agent } from '@atproto/api';
import type { AppBskyActorDefs } from '@atproto/api';
import { useSessionStore, saveRecentHandle, type SessionData } from '../store/sessionStore.js';
import { ATP_AUTH_EXPIRED_EVENT, atpCall } from '../lib/atproto/client.js';
import { normalizeError } from '../lib/atproto/errors.js';
import { withRetry } from '../lib/atproto/retry.js';
import {
  createOAuthState,
  getOAuthClient,
  getOAuthRequestedScope,
  getOAuthRuntimeConfigStatus,
  isHostedOAuthClientConfigured,
  isLikelyAuthIdentifier,
  sanitizeAuthIdentifier,
} from './oauthClient.js';
import {
  buildClearedOAuthCallbackUrl,
  getOAuthCallbackError,
  hasOAuthCallbackParams,
} from './oauthCallback.js';

const OAUTH_INIT_TIMEOUT_MS = 8_000;
let hasWarnedMissingAtpProvider = false;
let oauthInitInFlight: Promise<{ session?: unknown } | null> | null = null;
let oauthInitModeInFlight: 'callback' | 'restore' | null = null;
const enableAuthDebugLogs = import.meta.env.DEV && import.meta.env.VITE_OAUTH_DEBUG === '1';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toSafeAuthMessage(error: unknown, fallback: string): string {
  const normalized = normalizeError(error);

  switch (normalized.kind) {
    case 'network':
      return 'Could not reach your ATProto provider. Check your connection and try again.';
    case 'rate_limit':
      return 'Too many authentication attempts. Wait a moment and try again.';
    case 'server':
      return 'Your ATProto provider is temporarily unavailable. Please try again shortly.';
    case 'cancelled':
      return 'Request cancelled.';
    case 'auth':
      return 'Your session is no longer valid. Please sign in again.';
    default:
      return fallback;
  }
}

function toSafeAuthDiagnostic(error: unknown): { kind: string; message: string; status?: number } {
  const normalized = normalizeError(error);
  return {
    kind: normalized.kind,
    message: normalized.message,
    status: normalized.status,
  };
}

function normalizeScopeSet(scope: string | undefined): Set<string> {
  if (!scope) return new Set();
  return new Set(
    scope
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function hasRequiredGrantedScope(grantedScope: string | undefined, requestedScope: string): boolean {
  const requested = normalizeScopeSet(requestedScope);
  if (!requested.size) return true;

  const granted = normalizeScopeSet(grantedScope);
  
  // For localhost development, allow atproto scope even if transition:generic was requested
  // Loopback OAuth has limited permissions and may not grant transition:generic
  const isLocalhost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  
  if (isLocalhost && granted.has('atproto') && requested.has('atproto')) {
    // For localhost, if we have atproto scope, that's sufficient for development
    console.log('[OAuth Debug] Localhost development: accepting atproto scope only');
    return true;
  }
  
  for (const token of requested) {
    if (!granted.has(token)) {
      return false;
    }
  }

  return true;
}

function clearOAuthCallbackParams(): void {
  if (typeof window === 'undefined') return;

  const nextUrl = buildClearedOAuthCallbackUrl(window.location.href);
  if (!nextUrl) return;

  window.history.replaceState(window.history.state, '', nextUrl);
}

type OAuthBootstrapDebugPhase = 'callback_error' | 'callback_no_session' | 'restored_session' | 'bootstrap_error';

function recordOAuthBootstrapDebug(phase: OAuthBootstrapDebugPhase, detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(
      'glimpse:oauth:last-bootstrap',
      JSON.stringify({
        phase,
        timestamp: Date.now(),
        ...detail,
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

function recordOAuthLoginDebug(detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(
      'glimpse:oauth:last-login',
      JSON.stringify({
        timestamp: Date.now(),
        ...detail,
      }),
    );
  } catch {
    // Ignore storage failures.
  }
}

function toSafeLoginErrorShape(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { rawType: typeof error };
  }

  const safeMessage = error.message.slice(0, 240);
  const firstStackLine = error.stack?.split('\n')[0]?.slice(0, 240);
  return {
    rawName: error.name,
    rawMessage: safeMessage,
    ...(firstStackLine ? { rawStack: firstStackLine } : {}),
  };
}

function initOAuthSessionOnce(oauthClient: Awaited<ReturnType<typeof getOAuthClient>>, shouldProcessCallback: boolean) {
  const mode: 'callback' | 'restore' = shouldProcessCallback ? 'callback' : 'restore';
  if (oauthInitInFlight && oauthInitModeInFlight === mode) {
    return oauthInitInFlight;
  }

  oauthInitModeInFlight = mode;
  oauthInitInFlight = withTimeout(
    withRetry(
      () => oauthClient.init(shouldProcessCallback),
      {
        maxAttempts: 3,
        baseDelayMs: 350,
        capDelayMs: 1_500,
      },
    ),
    OAUTH_INIT_TIMEOUT_MS,
    'OAuth init timed out. Please try sign-in again.',
  )
    .finally(() => {
      oauthInitInFlight = null;
      oauthInitModeInFlight = null;
    });

  return oauthInitInFlight;
}

async function startOAuthLogin(
  identifier: string,
  setError: (message: string | null) => void,
): Promise<void> {
  setError(null);

  const configStatus = getOAuthRuntimeConfigStatus();
  if (!configStatus.canStartOAuth) {
    const message = configStatus.blockingMessage ?? 'OAuth configuration is not ready.';
    setError(message);
    throw new Error(message);
  }

  const sanitizedIdentifier = sanitizeAuthIdentifier(identifier);
  if (!isLikelyAuthIdentifier(sanitizedIdentifier)) {
    const message = 'Enter a valid Bluesky handle, DID, or provider URL.';
    setError(message);
    throw new Error(message);
  }

  try {
    const oauthClient = await getOAuthClient();
    const requestedScope = getOAuthRequestedScope();
    const state = createOAuthState();

    try {
      await oauthClient.signInRedirect(sanitizedIdentifier, {
        scope: requestedScope,
        state,
      });
    } catch (err: unknown) {
      const normalized = normalizeError(err);
      recordOAuthLoginDebug({
        kind: normalized.kind,
        status: normalized.status,
        message: normalized.message,
        ...toSafeLoginErrorShape(err),
      });
      if (normalized.status === 400 && requestedScope !== 'atproto') {
        // Some provider/local loopback combinations reject transition scopes.
        // Retry once with baseline scope so users can still complete sign-in.
        const fallbackState = createOAuthState();
        await oauthClient.signInRedirect(sanitizedIdentifier, {
          scope: 'atproto',
          state: fallbackState,
        });
        return;
      }
      throw err;
    }
  } catch (err: unknown) {
    const normalized = normalizeError(err);
    recordOAuthLoginDebug({
      phase: 'final_failure',
      kind: normalized.kind,
      status: normalized.status,
      message: normalized.message,
      ...toSafeLoginErrorShape(err),
    });
    setError(normalized.kind === 'cancelled' ? 'Sign-in was cancelled.' : toSafeAuthMessage(err, 'Could not start OAuth sign-in. Please try again.'));
    throw err;
  }
}

async function runLogout(
  currentDid: string | undefined,
  resetAgent: () => void,
  setError: (message: string | null) => void,
  setLoading: (value: boolean) => void,
): Promise<void> {
  if (currentDid) {
    try {
      const oauthClient = await getOAuthClient();
      await withRetry(
        () => oauthClient.revoke(currentDid),
        {
          maxAttempts: 2,
          baseDelayMs: 250,
          capDelayMs: 1_000,
        },
      );
    } catch (error) {
      // Ignore and proceed with local reset.
      if (enableAuthDebugLogs) {
        console.warn('[OAuth] Failed to revoke session during logout.', toSafeAuthDiagnostic(error));
      }
    }
  }
  resetAgent();
  setError(null);
  setLoading(false);
}

function useAtpFallbackValue(): AtpContextValue {
  const agent = useSessionStore((state) => state.agent);
  const session = useSessionStore((state) => state.session);
  const profile = useSessionStore((state) => state.profile);
  const isLoading = useSessionStore((state) => state.isLoading);
  const error = useSessionStore((state) => state.error);
  const setError = useSessionStore((state) => state.setError);
  const setLoading = useSessionStore((state) => state.setLoading);
  const resetAgent = useSessionStore((state) => state.resetAgent);
  const oauthRuntimeConfig = getOAuthRuntimeConfigStatus();

  const login = useCallback(async (identifier: string) => {
    await startOAuthLogin(identifier, setError);
  }, [setError]);

  const logout = useCallback(async () => {
    await runLogout(session?.did, resetAgent, setError, setLoading);
  }, [resetAgent, session?.did, setError, setLoading]);

  return {
    agent,
    session,
    profile,
    isLoading,
    error,
    login,
    logout,
    isHostedOAuthClientConfigured: isHostedOAuthClientConfigured(),
    oauthConfigWarning: oauthRuntimeConfig.warningMessage,
    oauthConfigBlockingError: oauthRuntimeConfig.blockingMessage,
  };
}

// ─── Public context shape ──────────────────────────────────────────────────
export interface AtpContextValue {
  session: SessionData | null;
  profile: AppBskyActorDefs.ProfileViewDetailed | null;
  isLoading: boolean;
  error: string | null;
  login: (identifier: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Direct agent access for one-off calls that aren't worth a query hook */
  agent: ReturnType<typeof useSessionStore>['agent'];
  isHostedOAuthClientConfigured: boolean;
  oauthConfigWarning: string | null;
  oauthConfigBlockingError: string | null;
}

const AtpContext = createContext<AtpContextValue | null>(null);

export function useAtp(): AtpContextValue {
  const ctx = useContext(AtpContext);
  const fallback = useAtpFallbackValue();

  if (!ctx) {
    if (!hasWarnedMissingAtpProvider) {
      hasWarnedMissingAtpProvider = true;
      if (enableAuthDebugLogs) {
        console.warn('[OAuth] useAtp() recovered from a missing provider boundary; using session-store fallback.');
      }
    }
    return fallback;
  }

  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────────────
export function AtpProvider({ children }: { children: React.ReactNode }) {
  const agent = useSessionStore((state) => state.agent);
  const session = useSessionStore((state) => state.session);
  const profile = useSessionStore((state) => state.profile);
  const isLoading = useSessionStore((state) => state.isLoading);
  const error = useSessionStore((state) => state.error);
  const setAgent = useSessionStore((state) => state.setAgent);
  const setSession = useSessionStore((state) => state.setSession);
  const setProfile = useSessionStore((state) => state.setProfile);
  const setLoading = useSessionStore((state) => state.setLoading);
  const setError = useSessionStore((state) => state.setError);
  const setSessionReady = useSessionStore((state) => state.setSessionReady);
  const resetAgent = useSessionStore((state) => state.resetAgent);
  const oauthRuntimeConfig = getOAuthRuntimeConfigStatus();

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      clearOAuthCallbackParams();
      resetAgent();
      setSession(null);
      setProfile(null);
      setSessionReady(false);
      setLoading(false);
      setError(detail?.message ?? 'Your session is no longer valid. Please sign in again.');
    };

    window.addEventListener(ATP_AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(ATP_AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [resetAgent, setError, setLoading, setProfile, setSession, setSessionReady]);

  // Restore OAuth session and process OAuth callbacks on first mount.
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const hardStopTimer = setTimeout(() => {
        if (cancelled) return;
        clearOAuthCallbackParams();
        resetAgent();
        setError('OAuth initialization is taking too long. Please try signing in again.');
        setSession(null);
        setProfile(null);
        setSessionReady(false);
        setLoading(false);
      }, OAUTH_INIT_TIMEOUT_MS + 4_000);

      setLoading(true);
      try {
        const hadCallbackParams = hasOAuthCallbackParams(window.location.search);
        const callbackError = getOAuthCallbackError(window.location.search);
        if (callbackError) {
          recordOAuthBootstrapDebug('callback_error', {
            hadCallbackParams,
            callbackErrorCode: callbackError.code,
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(callbackError.message);
          setSession(null);
          setProfile(null);
          setSessionReady(false);
          return;
        }

        const oauthClient = await getOAuthClient();
        const shouldProcessCallback = hadCallbackParams;
        const initResult = await initOAuthSessionOnce(oauthClient, shouldProcessCallback);
        if (cancelled) return;

        if (!initResult?.session) {
          recordOAuthBootstrapDebug('callback_no_session', {
            hadCallbackParams,
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(
            hadCallbackParams
              ? 'Sign-in completed but no session was returned. Please try again and make sure permissions are approved.'
              : null,
          );
          setSession(null);
          setProfile(null);
          setSessionReady(false);
          return;
        }

        const oauthSession = initResult.session;
        const authedAgent = new Agent(oauthSession);
        setAgent(authedAgent);

        let handle = oauthSession.did;
        let email: string | undefined;
        try {
          const profileRes = await atpCall(_signal => authedAgent.getProfile({ actor: oauthSession.did }));
          if (!cancelled) {
            setProfile(profileRes.data);
            handle = profileRes.data.handle || handle;
            saveRecentHandle({
              handle: profileRes.data.handle || handle,
              ...(profileRes.data.displayName ? { displayName: profileRes.data.displayName } : {}),
              ...(profileRes.data.avatar ? { avatar: profileRes.data.avatar } : {}),
            });
          }
        } catch {
          // Non-fatal.
        }

        const requestedScope = getOAuthRequestedScope();
        try {
          const tokenInfo = await oauthSession.getTokenInfo(false);
          if (!cancelled) {
            console.log('[OAuth Debug] Requested scope:', requestedScope);
            console.log('[OAuth Debug] Granted scope:', tokenInfo.scope);
            if (!hasRequiredGrantedScope(tokenInfo.scope, requestedScope)) {
              recordOAuthBootstrapDebug('bootstrap_error', {
                kind: 'auth',
                status: 403,
                reason: 'missing_scope',
                requestedScope,
                grantedScope: tokenInfo.scope,
              });
              clearOAuthCallbackParams();
              resetAgent();
              setSession(null);
              setProfile(null);
              setSessionReady(false);
              setError('Sign-in succeeded but required permissions were not granted. Please approve permissions and try again.');
              return;
            }

            setSession({
              did: oauthSession.did,
              handle,
              email,
              issuer: tokenInfo.iss,
              scope: tokenInfo.scope,
            });
          }
        } catch {
          if (!cancelled) {
            if (shouldProcessCallback && normalizeScopeSet(requestedScope).size > 0) {
              recordOAuthBootstrapDebug('bootstrap_error', {
                kind: 'auth',
                status: 403,
                reason: 'scope_verification_failed',
                requestedScope,
              });
              clearOAuthCallbackParams();
              resetAgent();
              setSession(null);
              setProfile(null);
              setSessionReady(false);
              setError('Sign-in completed, but permissions could not be verified. Please authorize access and try again.');
              return;
            }
            setSession({ did: oauthSession.did, handle, email });
          }
        }

        if (!cancelled) {
          recordOAuthBootstrapDebug('restored_session', {
            hadCallbackParams,
          });
          clearOAuthCallbackParams();
          setError(null);
          setSessionReady(true);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          recordOAuthBootstrapDebug('bootstrap_error', {
            kind: normalizeError(err).kind,
            status: normalizeError(err).status,
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(toSafeAuthMessage(err, 'We could not restore your session. Please sign in again.'));
          setSession(null);
          setProfile(null);
          setSessionReady(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        clearTimeout(hardStopTimer);
      }
    };

    void bootstrap();

    const handlePageShow = (event: PageTransitionEvent) => {
      if (cancelled || !event.persisted) return;

      if (hasOAuthCallbackParams(window.location.search)) {
        void bootstrap();
        return;
      }

      const currentState = useSessionStore.getState();
      if (!currentState.session) {
        setLoading(false);
        setSessionReady(false);
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [resetAgent, setAgent, setError, setLoading, setProfile, setSession, setSessionReady]);

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(async (identifier: string) => {
    await startOAuthLogin(identifier, setError);
  }, [setError]);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await runLogout(session?.did, resetAgent, setError, setLoading);
  }, [resetAgent, session?.did, setError, setLoading]);

  return (
    <AtpContext.Provider
      value={{
        agent,
        session,
        profile,
        isLoading,
        error,
        login,
        logout,
        isHostedOAuthClientConfigured: isHostedOAuthClientConfigured(),
        oauthConfigWarning: oauthRuntimeConfig.warningMessage,
        oauthConfigBlockingError: oauthRuntimeConfig.blockingMessage,
      }}
    >
      {children}
    </AtpContext.Provider>
  );
}
