import React from 'react';

const DEFAULT_RETRY_DELAY_MS = 300;
const LAZY_RELOAD_THROTTLE_MS = 30_000;
const LAZY_RELOAD_STORAGE_PREFIX = 'glympse.lazy.reload.';

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk [\w-]+ failed/i,
  /ChunkLoadError/i,
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(normalizeErrorMessage).join(' ');
  }
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

export function isRecoverableLazyChunkError(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function maybeTriggerLazyChunkReload(
  label: string,
  error: unknown,
  deps: {
    prod?: boolean;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    reload?: () => void;
    now?: () => number;
  } = {},
): boolean {
  const prod = deps.prod ?? import.meta.env.PROD;
  if (!prod) return false;
  if (!isRecoverableLazyChunkError(error)) return false;

  const reload = deps.reload ?? (() => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  });
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
  const storageKey = `${LAZY_RELOAD_STORAGE_PREFIX}${label}`;

  try {
    const lastAttemptRaw = storage?.getItem(storageKey) ?? '';
    const lastAttempt = /^\d+$/.test(lastAttemptRaw) ? Number(lastAttemptRaw) : Number.NaN;
    const currentTime = now();
    if (Number.isFinite(lastAttempt) && currentTime - lastAttempt < LAZY_RELOAD_THROTTLE_MS) {
      return false;
    }
    storage?.setItem(storageKey, String(currentTime));
  } catch {
    // Storage may be unavailable in private modes; reload is still the safest recovery.
  }

  reload();
  return true;
}

export function lazyWithRetry<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  label: string,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      console.warn(`[Lazy] ${label} failed to load on first attempt; retrying once.`, error);
      await delay(retryDelayMs);
      try {
        return await loader();
      } catch (retryError) {
        if (maybeTriggerLazyChunkReload(label, retryError)) {
          console.warn(`[Lazy] ${label} triggered a bounded page reload after a stale chunk failure.`, retryError);
        }
        throw retryError;
      }
    }
  });
}
