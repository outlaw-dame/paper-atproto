import { useEffect, useMemo, useRef } from 'react';
import {
  hydrateConversationSession,
  type HydrateConversationSessionParams,
} from './sessionAssembler';
import type { ConversationSessionMode } from './sessionTypes';
import { createVerificationProviders } from '../intelligence/verification/providerFactory';
import { InMemoryVerificationCache } from '../intelligence/verification/cache';
import { isAtUri } from '../lib/resolver/atproto';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 350;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_BATCH_TARGET_LIMIT = 8;
const DEFAULT_EVENT_REFRESH_MIN_INTERVAL_MS = 10_000;

export type ConversationHydrationPhase = 'initial' | 'poll' | 'event';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitteredBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const base = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(base * jitter);
}

export function collectConversationHydrationTargets(
  rootUris: string[],
  maxTargets = DEFAULT_BATCH_TARGET_LIMIT,
): string[] {
  return Array.from(
    new Set(
      rootUris.filter((uri): uri is string => isAtUri(uri)),
    ),
  ).slice(0, Math.max(0, maxTargets));
}

export async function hydrateConversationSessionWithRetry(
  params: HydrateConversationSessionParams & {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<void> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    ...hydrateParams
  } = params;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await hydrateConversationSession(hydrateParams);
      return;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt >= maxAttempts - 1) {
        break;
      }
      await sleep(jitteredBackoffMs(attempt, baseDelayMs, maxDelayMs));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export function shouldAllowEventDrivenHydrationRefresh(
  lastStartedAtMs: number,
  nowMs: number = Date.now(),
  minIntervalMs: number = DEFAULT_EVENT_REFRESH_MIN_INTERVAL_MS,
): boolean {
  if (lastStartedAtMs <= 0) return true;
  return (nowMs - lastStartedAtMs) >= Math.max(0, minIntervalMs);
}

export function useConversationHydration(
  params: HydrateConversationSessionParams & {
    enabled: boolean;
    pollIntervalMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    eventRefreshMinIntervalMs?: number;
    refreshOnWindowFocus?: boolean;
    refreshOnVisibility?: boolean;
    refreshOnReconnect?: boolean;
    onError?: (error: unknown, phase: ConversationHydrationPhase) => void;
  },
): void {
  const {
    enabled,
    pollIntervalMs,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    eventRefreshMinIntervalMs = DEFAULT_EVENT_REFRESH_MIN_INTERVAL_MS,
    refreshOnWindowFocus = true,
    refreshOnVisibility = true,
    refreshOnReconnect = true,
    onError,
    ...hydrateParams
  } = params;

  // Keep a stable ref to onError so callers can pass inline functions without
  // triggering the effect on every render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const hydrationInFlightRef = useRef(false);
  const lastStartedAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();

    const run = async (
      phase: ConversationHydrationPhase,
      options?: { bypassThrottle?: boolean },
    ) => {
      if (hydrationInFlightRef.current) return;
      if (
        phase === 'event'
        && !options?.bypassThrottle
        && !shouldAllowEventDrivenHydrationRefresh(
          lastStartedAtRef.current,
          Date.now(),
          eventRefreshMinIntervalMs,
        )
      ) {
        return;
      }

      hydrationInFlightRef.current = true;
      lastStartedAtRef.current = Date.now();

      try {
        await hydrateConversationSessionWithRetry({
          ...hydrateParams,
          signal: controller.signal,
          ...(typeof maxAttempts === 'number' ? { maxAttempts } : {}),
          ...(typeof baseDelayMs === 'number' ? { baseDelayMs } : {}),
          ...(typeof maxDelayMs === 'number' ? { maxDelayMs } : {}),
        });
      } catch (error) {
        if (isAbortError(error)) return;
        onErrorRef.current?.(error, phase);
      } finally {
        hydrationInFlightRef.current = false;
      }
    };

    void run('initial', { bypassThrottle: true });

    const cleanupFns: Array<() => void> = [];

    if (typeof window !== 'undefined' && refreshOnWindowFocus) {
      const handleFocus = () => {
        void run('event');
      };
      window.addEventListener('focus', handleFocus);
      cleanupFns.push(() => window.removeEventListener('focus', handleFocus));
    }

    if (typeof document !== 'undefined' && refreshOnVisibility) {
      const handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return;
        void run('event');
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      cleanupFns.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
    }

    if (typeof window !== 'undefined' && refreshOnReconnect) {
      const handleOnline = () => {
        void run('event', { bypassThrottle: true });
      };
      window.addEventListener('online', handleOnline);
      cleanupFns.push(() => window.removeEventListener('online', handleOnline));
    }

    if (!pollIntervalMs || pollIntervalMs <= 0) {
      return () => {
        controller.abort();
        cleanupFns.forEach((cleanup) => cleanup());
      };
    }

    const pollHandle = setInterval(() => {
      void run('poll');
    }, pollIntervalMs);

    return () => {
      controller.abort();
      clearInterval(pollHandle);
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [
    enabled,
    pollIntervalMs,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    eventRefreshMinIntervalMs,
    refreshOnWindowFocus,
    refreshOnVisibility,
    refreshOnReconnect,
    hydrateParams.sessionId,
    hydrateParams.rootUri,
    hydrateParams.mode,
    hydrateParams.agent,
    hydrateParams.translationPolicy,
    hydrateParams.providers,
    hydrateParams.cache,
  ]);
}

export function useConversationBatchHydration(params: {
  enabled: boolean;
  rootUris: string[];
  mode?: ConversationSessionMode;
  agent: HydrateConversationSessionParams['agent'];
  translationPolicy: HydrateConversationSessionParams['translationPolicy'];
  maxTargets?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onError?: (error: unknown, rootUri: string) => void;
}): string[] {
  const {
    enabled,
    rootUris,
    mode = 'thread',
    agent,
    translationPolicy,
    maxTargets = DEFAULT_BATCH_TARGET_LIMIT,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    onError,
  } = params;

  const providersRef = useRef(createVerificationProviders());
  const cacheRef = useRef(new InMemoryVerificationCache());
  const hydratedRootsRef = useRef<Set<string>>(new Set());
  const hydrationInFlightRef = useRef<Set<string>>(new Set());
  const targets = useMemo(
    () => collectConversationHydrationTargets(rootUris, maxTargets),
    [maxTargets, rootUris],
  );

  useEffect(() => {
    if (!enabled || targets.length === 0) return undefined;

    const controller = new AbortController();

    const hydrateTarget = async (rootUri: string) => {
      if (hydratedRootsRef.current.has(rootUri)) return;
      if (hydrationInFlightRef.current.has(rootUri)) return;
      hydrationInFlightRef.current.add(rootUri);

      try {
        await hydrateConversationSessionWithRetry({
          sessionId: rootUri,
          rootUri,
          mode,
          agent,
          translationPolicy,
          providers: providersRef.current,
          cache: cacheRef.current,
          signal: controller.signal,
          ...(typeof maxAttempts === 'number' ? { maxAttempts } : {}),
          ...(typeof baseDelayMs === 'number' ? { baseDelayMs } : {}),
          ...(typeof maxDelayMs === 'number' ? { maxDelayMs } : {}),
        });
        hydratedRootsRef.current.add(rootUri);
      } catch (error) {
        if (isAbortError(error)) return;
        onError?.(error, rootUri);
      } finally {
        hydrationInFlightRef.current.delete(rootUri);
      }
    };

    void Promise.all(targets.map((rootUri) => hydrateTarget(rootUri)));

    return () => {
      controller.abort();
    };
  }, [
    agent,
    baseDelayMs,
    enabled,
    maxAttempts,
    maxDelayMs,
    mode,
    onError,
    targets,
    translationPolicy,
  ]);

  return targets;
}
