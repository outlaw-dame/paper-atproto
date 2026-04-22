import { ValidationError } from './errors.js';
import { env } from '../config/env.js';

export function sanitizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, env.VERIFY_MAX_TEXT_CHARS);
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeUrls(urls: string[] | undefined | null): string[] {
  if (!urls?.length) return [];
  return urls
    .map((u) => sanitizeRemoteProcessingUrl(u))
    .filter((value): value is string => Boolean(value))
    .slice(0, env.VERIFY_MAX_URLS);
}

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

export function sanitizeRemoteProcessingUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    if (isPrivateOrLocalHostname(url.hostname)) {
      return null;
    }
    stripTrackingParams(url);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function requireNonEmptyText(value: string, field = 'text'): string {
  const sanitized = sanitizeText(value);
  if (!sanitized) throw new ValidationError(`${field} must not be empty`);
  return sanitized;
}

export function redactForLogs(value: string): string {
  const clean = sanitizeText(value);
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 80)}…`;
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
