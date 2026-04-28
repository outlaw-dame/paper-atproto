import type { Context } from 'hono';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export const API_CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Glympse-User-Did',
  'x-verify-shared-secret',
] as const;

export const API_CORS_ALLOW_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

type OriginPolicyOptions = {
  allowedOrigins?: Iterable<string>;
  allowPrivateNetworkInDev?: boolean;
  nodeEnv?: 'development' | 'test' | 'production';
};

function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return null;

  try {
    const parsed = new URL(trimmed);
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(raw: unknown): Set<string> {
  if (typeof raw !== 'string' || !raw.trim()) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((value) => normalizeOrigin(value))
      .filter((value): value is string => Boolean(value)),
  );
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

function requestHostForComparison(requestUrl: string): string | null {
  try {
    return new URL(requestUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function isDevelopmentLike(nodeEnv: OriginPolicyOptions['nodeEnv']): boolean {
  return nodeEnv !== 'production';
}

export function isTrustedOriginForRequest(
  origin: string,
  requestUrl: string,
  options?: OriginPolicyOptions,
): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const parsedOrigin = new URL(normalizedOrigin);
  const requestHost = requestHostForComparison(requestUrl);
  if (requestHost && parsedOrigin.host.toLowerCase() === requestHost) {
    return true;
  }

  const allowPrivateNetworkInDev = options?.allowPrivateNetworkInDev ?? env.CORS_ALLOW_PRIVATE_NETWORK_IN_DEV;
  const nodeEnv = options?.nodeEnv ?? env.NODE_ENV;
  if (
    allowPrivateNetworkInDev
    && isDevelopmentLike(nodeEnv)
    && isPrivateOrLocalHostname(parsedOrigin.hostname)
  ) {
    return true;
  }

  const allowedOrigins = options?.allowedOrigins
    ? new Set(Array.from(options.allowedOrigins).map((value) => normalizeOrigin(value)).filter((value): value is string => Boolean(value)))
    : parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  return allowedOrigins.has(normalizedOrigin);
}

export function resolveCorsOrigin(origin: string, c: Context): string | null {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return null;
  return isTrustedOriginForRequest(normalizedOrigin, c.req.url) ? normalizedOrigin : null;
}

export function appendVaryHeader(c: Context, value: string): void {
  c.header('Vary', value, { append: true });
}

export function assertTrustedBrowserOrigin(c: Context, purpose: string): string | null {
  const rawOrigin = c.req.header('Origin');
  if (!rawOrigin || !rawOrigin.trim()) {
    if (env.NODE_ENV !== 'production') {
      return null;
    }
    throw new AppError(403, 'FORBIDDEN', `${purpose} requires a trusted browser origin`);
  }

  const normalizedOrigin = normalizeOrigin(rawOrigin);
  if (!normalizedOrigin || !isTrustedOriginForRequest(normalizedOrigin, c.req.url)) {
    throw new AppError(403, 'FORBIDDEN', `${purpose} is not allowed from this origin`);
  }

  return normalizedOrigin;
}
