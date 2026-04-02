import { env } from '../config/env.js';
import { withRetry } from '../lib/retry.js';

const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const REQUEST_TIMEOUT_MS = 5000;
const SAFE_CACHE_TTL_MS = 5 * 60 * 1000;
const UNKNOWN_CACHE_TTL_MS = 30 * 1000;
const REQUEST_RETRY_ATTEMPTS = 3;
const REQUEST_RETRY_BASE_MS = 200;
const REQUEST_RETRY_MAX_MS = 1500;
const MAX_EXPIRED_SWEEP_PER_WRITE = 256;

const SAFE_BROWSING_CACHE_MAX_ENTRIES = (() => {
  const parsed = Number(env.SAFE_BROWSING_CACHE_MAX_ENTRIES ?? 2000);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
  return Math.max(100, Math.min(50_000, Math.floor(parsed)));
})();

const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
] as const;

type SafeBrowsingThreatType = typeof THREAT_TYPES[number];

const PLATFORM_TYPES = ['ANY_PLATFORM'] as const;
const THREAT_ENTRY_TYPES = ['URL'] as const;

export interface SafeBrowsingThreatMatch {
  threatType: SafeBrowsingThreatType | string;
  platformType: string;
  threatEntryType: string;
  url: string;
  cacheDuration?: string;
}

export interface SafeBrowsingUrlVerdict {
  url: string;
  checked: boolean;
  status: 'safe' | 'unsafe' | 'unknown';
  safe: boolean;
  blocked: boolean;
  reason?: string;
  threats: SafeBrowsingThreatMatch[];
}

interface ThreatMatchesFindResponse {
  matches?: Array<{
    threatType?: string;
    platformType?: string;
    threatEntryType?: string;
    threat?: { url?: string };
    cacheDuration?: string;
  }>;
}

interface CachedVerdict {
  expiresAt: number;
  verdict: SafeBrowsingUrlVerdict;
}

type RetryableError = Error & {
  status?: number;
  code?: string;
  details?: { retryAfterMs?: number };
};

const verdictCache = new Map<string, CachedVerdict>();
const inFlightChecks = new Map<string, Promise<SafeBrowsingUrlVerdict>>();

function sweepExpiredEntries(maxDeletes = MAX_EXPIRED_SWEEP_PER_WRITE): void {
  if (verdictCache.size === 0) return;
  const now = Date.now();
  let deleted = 0;

  for (const [key, entry] of verdictCache) {
    if (entry.expiresAt > now) continue;
    verdictCache.delete(key);
    deleted += 1;
    if (deleted >= maxDeletes) break;
  }
}

function evictOldestEntries(): void {
  while (verdictCache.size > SAFE_BROWSING_CACHE_MAX_ENTRIES) {
    const oldestKey = verdictCache.keys().next().value;
    if (!oldestKey) break;
    verdictCache.delete(oldestKey);
  }
}

function parseCacheDurationMs(raw?: string): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  if (!match || !match[1]) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

function getCachedVerdict(url: string): SafeBrowsingUrlVerdict | null {
  const hit = verdictCache.get(url);
  if (!hit) return null;

  if (Date.now() > hit.expiresAt) {
    verdictCache.delete(url);
    return null;
  }

  // Refresh insertion order so hot keys survive bounded-cache eviction.
  verdictCache.delete(url);
  verdictCache.set(url, hit);

  return hit.verdict;
}

function setCachedVerdict(url: string, verdict: SafeBrowsingUrlVerdict, ttlMs: number): void {
  sweepExpiredEntries();
  verdictCache.delete(url);
  verdictCache.set(url, {
    verdict,
    expiresAt: Date.now() + Math.max(1000, ttlMs),
  });
  evictOldestEntries();
}

export function shouldBlockSafeBrowsingVerdict(
  verdict: SafeBrowsingUrlVerdict,
  options?: {
    failClosed?: boolean;
  },
): boolean {
  if (verdict.blocked) return true;
  const failClosed = options?.failClosed ?? env.AI_SAFE_BROWSING_FAIL_CLOSED;
  return failClosed && verdict.status === 'unknown';
}

function normalizeCheckedUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return rawUrl;
  }
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.max(0, Math.round(asSeconds * 1000));
  }
  const asDate = Date.parse(headerValue);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

function isRetryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchThreatMatches(url: string, apiKey: string): Promise<ThreatMatchesFindResponse | null> {
  return withRetry<ThreatMatchesFindResponse | null>(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            client: {
              clientId: 'paper-atproto',
              clientVersion: '1.0.0',
            },
            threatInfo: {
              threatTypes: [...THREAT_TYPES],
              platformTypes: [...PLATFORM_TYPES],
              threatEntryTypes: [...THREAT_ENTRY_TYPES],
              threatEntries: [{ url }],
            },
          }),
        });

        if (!response.ok) {
          const body = (await response.text().catch(() => '')).slice(0, 300);
          if (isRetryableStatus(response.status)) {
            const retryable = new Error(
              `Safe Browsing request failed with ${response.status}${body ? `: ${body}` : ''}`,
            ) as RetryableError;
            retryable.status = response.status;
            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
            if (retryAfterMs != null) {
              retryable.details = { retryAfterMs };
            }
            throw retryable;
          }

          return null;
        }

        return (await response.json().catch(() => ({}))) as ThreatMatchesFindResponse;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const timedOut = new Error('Safe Browsing request timed out.') as RetryableError;
          timedOut.code = 'ETIMEDOUT';
          throw timedOut;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      attempts: REQUEST_RETRY_ATTEMPTS,
      baseDelayMs: REQUEST_RETRY_BASE_MS,
      maxDelayMs: REQUEST_RETRY_MAX_MS,
      jitter: true,
    },
  );
}

export async function checkUrlAgainstSafeBrowsing(rawUrl: string): Promise<SafeBrowsingUrlVerdict> {
  const url = normalizeCheckedUrl(rawUrl);
  const apiKey = env.GOOGLE_SAFE_BROWSING_API_KEY?.trim();

  const cached = getCachedVerdict(url);
  if (cached) {
    return cached;
  }

  if (!apiKey) {
    return {
      url,
      checked: false,
      status: 'unknown',
      safe: true,
      blocked: false,
      reason: 'Safe Browsing API key is not configured on the server.',
      threats: [],
    };
  }

  const inFlight = inFlightChecks.get(url);
  if (inFlight) {
    return inFlight;
  }

  const checkPromise = (async (): Promise<SafeBrowsingUrlVerdict> => {
    try {
      const payload = await fetchThreatMatches(url, apiKey);
      if (!payload) {
        const unknown = {
          url,
          checked: false,
          status: 'unknown',
          safe: true,
          blocked: false,
          reason: 'Safe Browsing request failed with a non-retryable status.',
          threats: [],
        } satisfies SafeBrowsingUrlVerdict;
        setCachedVerdict(url, unknown, UNKNOWN_CACHE_TTL_MS);
        return unknown;
      }

      const matches = Array.isArray(payload.matches) ? payload.matches : [];

      const threats: SafeBrowsingThreatMatch[] = matches.map((match) => ({
        threatType: match.threatType ?? 'UNKNOWN',
        platformType: match.platformType ?? 'UNKNOWN',
        threatEntryType: match.threatEntryType ?? 'UNKNOWN',
        url: match.threat?.url ?? url,
        ...(match.cacheDuration ? { cacheDuration: match.cacheDuration } : {}),
      }));

      if (threats.length > 0) {
        const ttlMs = threats
          .map((threat) => parseCacheDurationMs(threat.cacheDuration))
          .filter((value): value is number => value != null)
          .sort((a, b) => a - b)[0] ?? SAFE_CACHE_TTL_MS;

        const unsafe = {
          url,
          checked: true,
          status: 'unsafe',
          safe: false,
          blocked: true,
          reason: 'URL matched one or more Safe Browsing threat lists.',
          threats,
        } satisfies SafeBrowsingUrlVerdict;

        setCachedVerdict(url, unsafe, ttlMs);
        return unsafe;
      }

      const safe = {
        url,
        checked: true,
        status: 'safe',
        safe: true,
        blocked: false,
        threats: [],
      } satisfies SafeBrowsingUrlVerdict;

      setCachedVerdict(url, safe, SAFE_CACHE_TTL_MS);
      return safe;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Safe Browsing request failed.';
      const unknown = {
        url,
        checked: false,
        status: 'unknown',
        safe: true,
        blocked: false,
        reason,
        threats: [],
      } satisfies SafeBrowsingUrlVerdict;
      setCachedVerdict(url, unknown, UNKNOWN_CACHE_TTL_MS);
      return unknown;
    }
  })();

  inFlightChecks.set(url, checkPromise);

  try {
    return await checkPromise;
  } finally {
    inFlightChecks.delete(url);
  }
}
