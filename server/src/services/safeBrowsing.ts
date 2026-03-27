import { env } from '../config/env.js';

const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const REQUEST_TIMEOUT_MS = 5000;
const SAFE_CACHE_TTL_MS = 5 * 60 * 1000;
const UNKNOWN_CACHE_TTL_MS = 30 * 1000;

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

const verdictCache = new Map<string, CachedVerdict>();

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

  return hit.verdict;
}

function setCachedVerdict(url: string, verdict: SafeBrowsingUrlVerdict, ttlMs: number): void {
  verdictCache.set(url, {
    verdict,
    expiresAt: Date.now() + Math.max(1000, ttlMs),
  });
}

function normalizeCheckedUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return rawUrl;
  }
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
      const body = await response.text().catch(() => '');
      const unknown = {
        url,
        checked: false,
        status: 'unknown',
        safe: true,
        blocked: false,
        reason: `Safe Browsing request failed with ${response.status}${body ? `: ${body}` : ''}`,
        threats: [],
      } satisfies SafeBrowsingUrlVerdict;
      setCachedVerdict(url, unknown, UNKNOWN_CACHE_TTL_MS);
      return unknown;
    }

    const payload = (await response.json().catch(() => ({}))) as ThreatMatchesFindResponse;
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
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'Safe Browsing request timed out.'
      : 'Safe Browsing request failed.';
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
  } finally {
    clearTimeout(timeout);
  }
}
