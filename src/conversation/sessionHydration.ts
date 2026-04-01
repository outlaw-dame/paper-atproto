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

export function useConversationHydration(
  params: HydrateConversationSessionParams & {
    enabled: boolean;
    pollIntervalMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onError?: (error: unknown, phase: 'initial' | 'poll') => void;
  },
): void {
  const {
    enabled,
    pollIntervalMs,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    onError,
    ...hydrateParams
  } = params;

  // Keep a stable ref to onError so callers can pass inline functions without
  // triggering the effect on every render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();

    const run = async (phase: 'initial' | 'poll') => {
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
      }
    };

    void run('initial');

    if (!pollIntervalMs || pollIntervalMs <= 0) {
      return () => {
        controller.abort();
      };
    }

    const pollHandle = setInterval(() => {
      void run('poll');
    }, pollIntervalMs);

    return () => {
      controller.abort();
      clearInterval(pollHandle);
    };
  }, [
    enabled,
    pollIntervalMs,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
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
