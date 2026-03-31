import { useEffect } from 'react';
import {
  hydrateConversationSession,
  type HydrateConversationSessionParams,
} from './sessionAssembler';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 350;
const DEFAULT_MAX_DELAY_MS = 4_000;

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
        onError?.(error, phase);
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
    onError,
    hydrateParams.sessionId,
    hydrateParams.rootUri,
    hydrateParams.mode,
    hydrateParams.agent,
    hydrateParams.translationPolicy,
    hydrateParams.providers,
    hydrateParams.cache,
  ]);
}
