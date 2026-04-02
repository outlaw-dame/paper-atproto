import { checkUrlSafety } from './urlSafety';
import {
  recordExternalUrlAttempt,
  recordExternalUrlBlockedError,
  recordExternalUrlBlockedUnknown,
  recordExternalUrlBlockedUnsafe,
  recordExternalUrlOpened,
  recordExternalUrlRejectedInvalid,
} from './externalUrlTelemetry';

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^mc_[ce]id$/i,
  /^mkt_tok$/i,
  /^igshid$/i,
  /^ref(_src)?$/i,
  /^source$/i,
  /^si$/i,
];

function hasDangerousControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/.test(value);
}

type SanitizeExternalUrlOptions = {
  stripTracking?: boolean;
  stripHash?: boolean;
  rejectLocalHosts?: boolean;
};

const FAIL_CLOSED_ON_UNKNOWN = (() => {
  const raw = String((import.meta as any).env?.VITE_EXTERNAL_URL_FAIL_CLOSED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
})();

type OpenExternalUrlOptions = {
  failClosedOnUnknown?: boolean;
};

export function sanitizeExternalUrl(
  rawUrl: string,
  options: SanitizeExternalUrlOptions = {},
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || hasDangerousControlChars(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }

    if (options.rejectLocalHosts && isPrivateOrLocalHostname(parsed.hostname)) {
      return null;
    }

    if (options.stripTracking) {
      stripTrackingParams(parsed);
    }

    if (options.stripHash) {
      parsed.hash = '';
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeUrlForProcessing(rawUrl: string): string | null {
  return sanitizeExternalUrl(rawUrl, {
    stripTracking: true,
    stripHash: true,
    rejectLocalHosts: true,
  });
}

export function getSafeExternalHostname(rawUrl: string): string | null {
  const sanitized = sanitizeExternalUrl(rawUrl);
  if (!sanitized) return null;

  try {
    return new URL(sanitized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function openExternalUrl(rawUrl: string, options: OpenExternalUrlOptions = {}): Promise<boolean> {
  recordExternalUrlAttempt();
  const sanitized = sanitizeExternalUrl(rawUrl, { rejectLocalHosts: true });
  if (!sanitized || typeof window === 'undefined') {
    recordExternalUrlRejectedInvalid();
    return false;
  }

  const hostname = getSafeExternalHostname(sanitized);

  try {
    const verdict = await checkUrlSafety(sanitized);
    const failClosedOnUnknown = options.failClosedOnUnknown ?? FAIL_CLOSED_ON_UNKNOWN;
    if (verdict.status === 'unsafe') {
      recordExternalUrlBlockedUnsafe(hostname);
      return false;
    }

    if (failClosedOnUnknown && verdict.status === 'unknown') {
      recordExternalUrlBlockedUnknown(hostname);
      return false;
    }

    window.open(sanitized, '_blank', 'noopener,noreferrer');
    recordExternalUrlOpened(hostname);
    return true;
  } catch (error) {
    recordExternalUrlBlockedError(error);
    return false;
  }

}

function stripTrackingParams(url: URL): void {
  const keys = Array.from(url.searchParams.keys());
  for (const key of keys) {
    if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return true;

  if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.local')) {
    return true;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    const octets = normalized.split('.').map((part) => Number(part));
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }

    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    if (
      a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
    ) {
      return true;
    }
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }

  return false;
}
