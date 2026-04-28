import { getConfiguredApiBaseUrl, resolveApiUrl } from '../apiBase';

export interface UrlThreatMatch {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  url: string;
  cacheDuration?: string;
}

export interface UrlSafetyVerdict {
  url: string;
  checked: boolean;
  status: 'safe' | 'unsafe' | 'unknown';
  safe: boolean;
  blocked: boolean;
  reason?: string;
  threats: UrlThreatMatch[];
}

const BASE_URL = getConfiguredApiBaseUrl(
  (import.meta as any).env?.VITE_GLYMPSE_VERIFY_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_LLM_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
);

const TIMEOUT_MS = 6000;
const SAFE_CACHE_TTL_MS = 5 * 60 * 1000;
const UNKNOWN_CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 1000;

type SafetyCacheEntry = {
  expiresAt: number;
  promise: Promise<UrlSafetyVerdict>;
};

const cache = new Map<string, SafetyCacheEntry>();

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return rawUrl;
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function unknownVerdict(url: string, reason?: string): UrlSafetyVerdict {
  return {
    url,
    checked: false,
    status: 'unknown',
    safe: true,
    blocked: false,
    ...(reason ? { reason } : {}),
    threats: [],
  };
}

async function fetchUrlSafety(url: string): Promise<UrlSafetyVerdict> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(resolveApiUrl('/api/safety/url-check', BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return unknownVerdict(url, `Safety check endpoint returned ${response.status}.`);
    }

    const payload = await response.json() as {
      ok?: boolean;
      result?: UrlSafetyVerdict;
      error?: { message?: string };
    };

    if (!payload?.ok || !payload.result) {
      return unknownVerdict(url, payload?.error?.message ?? 'Safety check returned an invalid payload.');
    }

    return payload.result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return unknownVerdict(url, 'Safety check timed out.');
    }
    return unknownVerdict(url, 'Safety check failed.');
  } finally {
    window.clearTimeout(timeout);
  }
}

function cacheTtlMs(verdict: UrlSafetyVerdict): number {
  return verdict.status === 'unknown' ? UNKNOWN_CACHE_TTL_MS : SAFE_CACHE_TTL_MS;
}

function pruneExpiredCache(now = Date.now()): void {
  if (cache.size === 0) return;
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt > now) continue;
    cache.delete(key);
  }
}

function enforceCacheBounds(): void {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export function checkUrlSafety(rawUrl: string): Promise<UrlSafetyVerdict> {
  const normalized = normalizeUrl(rawUrl);
  const now = Date.now();
  pruneExpiredCache(now);

  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now) {
    // Refresh insertion order so hot keys survive bounded-cache eviction.
    cache.delete(normalized);
    cache.set(normalized, cached);
    return cached.promise;
  }

  if (cached) {
    cache.delete(normalized);
  }

  const promise = fetchUrlSafety(normalized).then((verdict) => {
    const entry = cache.get(normalized);
    if (entry) {
      entry.expiresAt = Date.now() + cacheTtlMs(verdict);
      cache.delete(normalized);
      cache.set(normalized, entry);
      enforceCacheBounds();
    }
    return verdict;
  });

  cache.set(normalized, {
    promise,
    expiresAt: now + UNKNOWN_CACHE_TTL_MS,
  });
  enforceCacheBounds();

  return promise;
}
