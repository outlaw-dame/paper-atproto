import { jsx } from "react/jsx-runtime";
import React, { createContext, useContext, useEffect, useCallback } from "react";
import { Agent } from "@atproto/api";
import { useSessionStore, saveRecentHandle, clearRecentHandles } from "../store/sessionStore.js";
import { ATP_AUTH_EXPIRED_EVENT, atpCall } from "../lib/atproto/client.js";
import { normalizeError } from "../lib/atproto/errors.js";
import { withRetry } from "../lib/atproto/retry.js";
import {
  FOLLOWING_TIMELINE_SCOPE,
  createOAuthState,
  getOAuthClient,
  getOAuthRequestedScope,
  getOAuthRuntimeConfigStatus,
  hasFollowingFeedScope,
  isHostedOAuthClientConfigured,
  isLoopbackOAuthOrigin,
  isLikelyAuthIdentifier,
  sanitizeAuthIdentifier,
  withRecoveredOAuthClient
} from "./oauthClient.js";
import {
  buildClearedOAuthCallbackUrl,
  getOAuthCallbackError,
  hasOAuthCallbackParams
} from "./oauthCallback.js";
const OAUTH_INIT_TIMEOUT_MS = 8e3;
let hasWarnedMissingAtpProvider = false;
let oauthInitInFlight = null;
let oauthInitModeInFlight = null;
const enableAuthDebugLogs = import.meta.env.DEV && import.meta.env.VITE_OAUTH_DEBUG === "1";
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function toSafeAuthMessage(error, fallback) {
  const normalized = normalizeError(error);
  switch (normalized.kind) {
    case "network":
      return "Could not reach your ATProto provider. Check your connection and try again.";
    case "rate_limit":
      return "Too many authentication attempts. Wait a moment and try again.";
    case "server":
      return "Your ATProto provider is temporarily unavailable. Please try again shortly.";
    case "cancelled":
      return "Request cancelled.";
    case "auth":
      return "Your session is no longer valid. Please sign in again.";
    default:
      return fallback;
  }
}
function toSafeAuthDiagnostic(error) {
  const normalized = normalizeError(error);
  return {
    kind: normalized.kind,
    message: normalized.message,
    status: normalized.status
  };
}
function normalizeScopeSet(scope) {
  if (!scope) return /* @__PURE__ */ new Set();
  return new Set(
    scope.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  );
}
function hasRequiredGrantedScope(grantedScope, requestedScope) {
  const requested = normalizeScopeSet(requestedScope);
  if (!requested.size) return true;
  const required = new Set(
    [...requested].filter((token) => token === "atproto" || !token.startsWith("transition:"))
  );
  if (!required.size) return true;
  const granted = normalizeScopeSet(grantedScope);
  for (const token of required) {
    if (!granted.has(token)) {
      return false;
    }
  }
  return true;
}
function shouldInvalidateHostedAuthOnlySession(grantedScope, requestedScope) {
  const requested = normalizeScopeSet(requestedScope);
  if (!requested.has(FOLLOWING_TIMELINE_SCOPE)) return false;
  return !hasFollowingFeedScope(grantedScope);
}
function clearOAuthCallbackParams() {
  if (typeof window === "undefined") return;
  const nextUrl = buildClearedOAuthCallbackUrl(window.location.href);
  if (!nextUrl) return;
  window.history.replaceState(window.history.state, "", nextUrl);
}
function clearCachedOAuthBrowserState() {
  if (typeof window === "undefined") return;
  const clearFromStorage = (storage) => {
    const keysToRemove = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("@@atproto/oauth-client-browser")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  };
  try {
    clearFromStorage(localStorage);
  } catch {
  }
  try {
    clearFromStorage(sessionStorage);
  } catch {
  }
}
async function clearInsufficientScopeSession(oauthClient, did) {
  try {
    await oauthClient.revoke(did);
  } catch (error) {
    if (enableAuthDebugLogs) {
      console.warn("[OAuth] Failed to revoke insufficient-scope session.", toSafeAuthDiagnostic(error));
    }
  }
  clearCachedOAuthBrowserState();
}
function recordOAuthBootstrapDebug(phase, detail = {}) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      "glimpse:oauth:last-bootstrap",
      JSON.stringify({
        phase,
        timestamp: Date.now(),
        ...detail
      })
    );
  } catch {
  }
}
function recordOAuthLoginDebug(detail = {}) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      "glimpse:oauth:last-login",
      JSON.stringify({
        timestamp: Date.now(),
        ...detail
      })
    );
  } catch {
  }
}
function toSafeLoginErrorShape(error) {
  if (!(error instanceof Error)) {
    return { rawType: typeof error };
  }
  const safeMessage = error.message.slice(0, 240);
  const firstStackLine = error.stack?.split("\n")[0]?.slice(0, 240);
  return {
    rawName: error.name,
    rawMessage: safeMessage,
    ...firstStackLine ? { rawStack: firstStackLine } : {}
  };
}
function initOAuthSessionOnce(oauthClient, shouldProcessCallback) {
  const mode = shouldProcessCallback ? "callback" : "restore";
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
        capDelayMs: 1500
      }
    ),
    OAUTH_INIT_TIMEOUT_MS,
    "OAuth init timed out. Please try sign-in again."
  ).finally(() => {
    oauthInitInFlight = null;
    oauthInitModeInFlight = null;
  });
  return oauthInitInFlight;
}
async function startOAuthLogin(identifier, setError) {
  setError(null);
  const configStatus = getOAuthRuntimeConfigStatus();
  if (!configStatus.canStartOAuth) {
    const message = configStatus.blockingMessage ?? "OAuth configuration is not ready.";
    setError(message);
    throw new Error(message);
  }
  const sanitizedIdentifier = sanitizeAuthIdentifier(identifier);
  if (!isLikelyAuthIdentifier(sanitizedIdentifier)) {
    const message = "Enter a valid Bluesky handle, DID, or provider URL.";
    setError(message);
    throw new Error(message);
  }
  try {
    const requestedScope = getOAuthRequestedScope();
    const effectiveRequestedScope = requestedScope;
    const state = createOAuthState();
    await withRecoveredOAuthClient(async (oauthClient) => {
      await oauthClient.signInRedirect(sanitizedIdentifier, {
        scope: effectiveRequestedScope,
        state,
        ...isLoopbackOAuthOrigin() ? { prompt: "login" } : { prompt: "consent" }
      });
    }, "sign-in redirect").catch((err) => {
      const normalized = normalizeError(err);
      recordOAuthLoginDebug({
        kind: normalized.kind,
        status: normalized.status,
        message: normalized.message,
        ...toSafeLoginErrorShape(err)
      });
      throw err;
    });
  } catch (err) {
    const normalized = normalizeError(err);
    recordOAuthLoginDebug({
      phase: "final_failure",
      kind: normalized.kind,
      status: normalized.status,
      message: normalized.message,
      ...toSafeLoginErrorShape(err)
    });
    setError(normalized.kind === "cancelled" ? "Sign-in was cancelled." : toSafeAuthMessage(err, "Could not start OAuth sign-in. Please try again."));
    throw err;
  }
}
async function runLogout(currentDid, resetAgent, setError, setLoading) {
  if (currentDid) {
    try {
      await withRecoveredOAuthClient((oauthClient) => withRetry(
        () => oauthClient.revoke(currentDid),
        {
          maxAttempts: 2,
          baseDelayMs: 250,
          capDelayMs: 1e3
        }
      ), "logout revoke");
    } catch (error) {
      if (enableAuthDebugLogs) {
        console.warn("[OAuth] Failed to revoke session during logout.", toSafeAuthDiagnostic(error));
      }
    }
  }
  resetAgent();
  clearRecentHandles();
  setError(null);
  setLoading(false);
}
function useAtpFallbackValue() {
  const agent = useSessionStore((state) => state.agent);
  const session = useSessionStore((state) => state.session);
  const profile = useSessionStore((state) => state.profile);
  const isLoading = useSessionStore((state) => state.isLoading);
  const error = useSessionStore((state) => state.error);
  const setError = useSessionStore((state) => state.setError);
  const setLoading = useSessionStore((state) => state.setLoading);
  const resetAgent = useSessionStore((state) => state.resetAgent);
  const oauthRuntimeConfig = getOAuthRuntimeConfigStatus();
  const login = useCallback(async (identifier) => {
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
    oauthConfigBlockingError: oauthRuntimeConfig.blockingMessage
  };
}
const AtpContext = createContext(null);
function useAtp() {
  const ctx = useContext(AtpContext);
  const fallback = useAtpFallbackValue();
  if (!ctx) {
    if (!hasWarnedMissingAtpProvider) {
      hasWarnedMissingAtpProvider = true;
      if (enableAuthDebugLogs) {
        console.warn("[OAuth] useAtp() recovered from a missing provider boundary; using session-store fallback.");
      }
    }
    return fallback;
  }
  return ctx;
}
function AtpProvider({ children }) {
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
    const handleAuthExpired = (event) => {
      const detail = event.detail;
      clearOAuthCallbackParams();
      resetAgent();
      setSession(null);
      setProfile(null);
      setSessionReady(false);
      setLoading(false);
      setError(detail?.message ?? "Your session is no longer valid. Please sign in again.");
    };
    window.addEventListener(ATP_AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(ATP_AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [resetAgent, setError, setLoading, setProfile, setSession, setSessionReady]);
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const hardStopTimer = setTimeout(() => {
        if (cancelled) return;
        clearOAuthCallbackParams();
        resetAgent();
        setError("OAuth initialization is taking too long. Please try signing in again.");
        setSession(null);
        setProfile(null);
        setSessionReady(false);
        setLoading(false);
      }, OAUTH_INIT_TIMEOUT_MS + 4e3);
      setLoading(true);
      try {
        const hadCallbackParams = hasOAuthCallbackParams(window.location.search);
        const callbackError = getOAuthCallbackError(window.location.search);
        if (callbackError) {
          recordOAuthBootstrapDebug("callback_error", {
            hadCallbackParams,
            callbackErrorCode: callbackError.code
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(callbackError.message);
          setSession(null);
          setProfile(null);
          setSessionReady(false);
          return;
        }
        let oauthClient = null;
        const initOAuthSession = (shouldProcessCallback2) => withRecoveredOAuthClient(async (client) => {
          oauthClient = client;
          return initOAuthSessionOnce(client, shouldProcessCallback2);
        }, shouldProcessCallback2 ? "oauth callback init" : "oauth session restore");
        const shouldProcessCallback = hadCallbackParams;
        let initResult;
        try {
          initResult = await initOAuthSession(shouldProcessCallback);
        } catch (initError) {
          if (shouldProcessCallback) {
            throw initError;
          }
          recordOAuthBootstrapDebug("bootstrap_error", {
            kind: normalizeError(initError).kind,
            status: normalizeError(initError).status,
            reason: "restore_init_first_attempt_failed"
          });
          clearCachedOAuthBrowserState();
          initResult = await initOAuthSession(false);
        }
        if (cancelled) return;
        if (!initResult?.session) {
          recordOAuthBootstrapDebug("callback_no_session", {
            hadCallbackParams
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(
            hadCallbackParams ? "Sign-in completed but no session was returned. Please try again and make sure permissions are approved." : null
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
        let email;
        try {
          const profileRes = await atpCall((_signal) => authedAgent.getProfile({ actor: oauthSession.did }));
          if (!cancelled) {
            setProfile(profileRes.data);
            handle = profileRes.data.handle || handle;
            saveRecentHandle({
              handle: profileRes.data.handle || handle,
              ...profileRes.data.displayName ? { displayName: profileRes.data.displayName } : {},
              ...profileRes.data.avatar ? { avatar: profileRes.data.avatar } : {}
            });
          }
        } catch {
        }
        const requestedScope = getOAuthRequestedScope();
        const effectiveRequestedScope = requestedScope;
        try {
          const tokenInfo = await oauthSession.getTokenInfo(false);
          if (!cancelled) {
            if (shouldInvalidateHostedAuthOnlySession(tokenInfo.scope, effectiveRequestedScope)) {
              recordOAuthBootstrapDebug("bootstrap_error", {
                kind: "auth",
                status: 403,
                reason: "hosted_auth_only_scope",
                requestedScope,
                grantedScope: tokenInfo.scope
              });
              clearOAuthCallbackParams();
              if (oauthClient) {
                await clearInsufficientScopeSession(oauthClient, oauthSession.did);
              } else {
                clearCachedOAuthBrowserState();
              }
              resetAgent();
              setSession(null);
              setProfile(null);
              setSessionReady(false);
              setError("This HTTPS sign-in did not grant Following feed access. The partial session was cleared. Sign in again here and approve the Bluesky timeline permission if prompted.");
              return;
            }
            if (!hasRequiredGrantedScope(tokenInfo.scope, effectiveRequestedScope)) {
              recordOAuthBootstrapDebug("bootstrap_error", {
                kind: "auth",
                status: 403,
                reason: "missing_scope",
                requestedScope,
                grantedScope: tokenInfo.scope
              });
              clearOAuthCallbackParams();
              if (oauthClient) {
                await clearInsufficientScopeSession(oauthClient, oauthSession.did);
              } else {
                clearCachedOAuthBrowserState();
              }
              resetAgent();
              setSession(null);
              setProfile(null);
              setSessionReady(false);
              setError("Sign-in succeeded but required permissions were not granted. Please approve permissions and try again.");
              return;
            }
            setSession({
              did: oauthSession.did,
              handle,
              email,
              issuer: tokenInfo.iss,
              scope: tokenInfo.scope
            });
          }
        } catch {
          if (!cancelled) {
            if (shouldProcessCallback && normalizeScopeSet(effectiveRequestedScope).size > 0) {
              recordOAuthBootstrapDebug("bootstrap_error", {
                kind: "auth",
                status: 403,
                reason: "scope_verification_failed",
                requestedScope
              });
              clearOAuthCallbackParams();
              resetAgent();
              setSession(null);
              setProfile(null);
              setSessionReady(false);
              setError("Sign-in completed, but permissions could not be verified. Please authorize access and try again.");
              return;
            }
            setSession({ did: oauthSession.did, handle, email });
          }
        }
        if (!cancelled) {
          recordOAuthBootstrapDebug("restored_session", {
            hadCallbackParams
          });
          try {
            sessionStorage.removeItem("glimpse:oauth:last-auth-failure");
          } catch {
          }
          clearOAuthCallbackParams();
          setError(null);
          setSessionReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          recordOAuthBootstrapDebug("bootstrap_error", {
            kind: normalizeError(err).kind,
            status: normalizeError(err).status,
            ...toSafeLoginErrorShape(err)
          });
          clearOAuthCallbackParams();
          resetAgent();
          setError(toSafeAuthMessage(err, "We could not restore your session. Please sign in again."));
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
    const handlePageShow = (event) => {
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
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [resetAgent, setAgent, setError, setLoading, setProfile, setSession, setSessionReady]);
  const login = useCallback(async (identifier) => {
    await startOAuthLogin(identifier, setError);
  }, [setError]);
  const logout = useCallback(async () => {
    await runLogout(session?.did, resetAgent, setError, setLoading);
  }, [resetAgent, session?.did, setError, setLoading]);
  return /* @__PURE__ */ jsx(
    AtpContext.Provider,
    {
      value: {
        agent,
        session,
        profile,
        isLoading,
        error,
        login,
        logout,
        isHostedOAuthClientConfigured: isHostedOAuthClientConfigured(),
        oauthConfigWarning: oauthRuntimeConfig.warningMessage,
        oauthConfigBlockingError: oauthRuntimeConfig.blockingMessage
      },
      children
    }
  );
}
export {
  AtpProvider,
  useAtp
};
