import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const AUTH_DID_HEADER = 'X-Authenticated-User-Did';
const AUTH_DID_TS_HEADER = 'X-Authenticated-User-Did-Ts';
const AUTH_DID_SIG_HEADER = 'X-Authenticated-User-Did-Signature';
const LEGACY_DID_HEADER = 'X-Glympse-User-Did';

type SignedDidPayload = {
  did: string;
  tsMs: number;
  sig: string;
};

function parseDid(value: string | null | undefined): string | null {
  const did = String(value ?? '').trim();
  if (!did) return null;
  return DID_PATTERN.test(did) ? did : null;
}

function splitServiceTokens(): string[] {
  return String(env.AUTH_SERVICE_TOKENS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(c: Context): string | null {
  const header = c.req.header('Authorization') ?? c.req.header('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
}

function hasValidServiceToken(c: Context): boolean {
  const presented = extractBearerToken(c) || c.req.header('x-verify-shared-secret')?.trim() || null;
  if (!presented) return false;

  const candidates = splitServiceTokens();
  if (env.VERIFY_SHARED_SECRET?.trim()) candidates.push(env.VERIFY_SHARED_SECRET.trim());

  for (const expected of candidates) {
    if (!expected) continue;
    if (secureEquals(presented, expected)) return true;
  }
  return false;
}

function parseSignedDidHeaders(c: Context): SignedDidPayload | null {
  const did = parseDid(c.req.header(AUTH_DID_HEADER));
  const tsRaw = c.req.header(AUTH_DID_TS_HEADER)?.trim() ?? '';
  const sig = c.req.header(AUTH_DID_SIG_HEADER)?.trim() ?? '';

  if (!did || !tsRaw || !sig) return null;

  const tsMs = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return null;

  return { did, tsMs, sig };
}

function hasValidSignedDid(c: Context): boolean {
  const parsed = parseSignedDidHeaders(c);
  if (!parsed) return false;

  const secret = env.AUTH_DID_HMAC_SECRET?.trim();
  if (!secret) return false;

  const now = Date.now();
  const ttlMs = Math.max(30_000, env.AUTH_DID_SIGNATURE_TTL_MS);
  const driftMs = Math.abs(now - parsed.tsMs);
  if (driftMs > ttlMs) return false;

  const expectedSig = createHmac('sha256', secret)
    .update(`${parsed.did}.${parsed.tsMs}`)
    .digest('hex');

  return secureEquals(parsed.sig, expectedSig);
}

function allowLegacyDidHeader(): boolean {
  if (env.AUTH_ALLOW_LEGACY_DID_HEADER) return true;
  return env.NODE_ENV !== 'production';
}

export function shouldEnforceSensitiveRouteAuth(): boolean {
  if (env.NODE_ENV === 'test') return false;
  if (env.NODE_ENV === 'production') return true;
  return env.AUTH_REQUIRE_SENSITIVE_ROUTE_AUTH;
}

export function assertSensitiveRouteAuthorized(c: Context, purpose: string): void {
  if (!shouldEnforceSensitiveRouteAuth()) return;
  if (hasValidServiceToken(c)) return;
  if (hasValidSignedDid(c)) return;
  throw new UnauthorizedError(`Unauthorized ${purpose}. Provide a valid bearer token or signed DID headers.`);
}

export function getAuthorizedActorDid(c: Context, purpose: string): string {
  assertSensitiveRouteAuthorized(c, purpose);

  const signedDid = parseSignedDidHeaders(c)?.did;
  if (signedDid && hasValidSignedDid(c)) return signedDid;

  const legacyDid = parseDid(c.req.header(LEGACY_DID_HEADER));
  if (legacyDid && allowLegacyDidHeader()) return legacyDid;

  throw new UnauthorizedError(`Missing authenticated DID for ${purpose}.`);
}

export function getOptionalAuthorizedActorDid(c: Context): string | undefined {
  const signedDid = parseSignedDidHeaders(c)?.did;
  if (signedDid && hasValidSignedDid(c)) return signedDid;

  const legacyDid = parseDid(c.req.header(LEGACY_DID_HEADER));
  if (legacyDid && allowLegacyDidHeader()) return legacyDid;
  return undefined;
}
