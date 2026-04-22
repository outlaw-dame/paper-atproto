// ─── Verification Provider Factory ────────────────────────────────────────
// Safe client-side factory for VerificationProviders.
//
// Reads VITE_GLYMPSE_VERIFY_BASE_URL from the Vite environment. If absent or
// empty the factory returns heuristic/noop providers so the app works without
// any backend wired up. The instance is cached so repeated calls are free.
//
// Env vars:
//   VITE_GLYMPSE_VERIFY_BASE_URL   — base URL of the verify-server (no trailing slash)
//   VITE_GLYMPSE_VERIFY_TIMEOUT_MS — per-request timeout, default 6000ms

import type { VerificationProviders } from './types';
import {
  HeuristicClaimExtractorProvider,
  NoopFactCheckProvider,
  NoopGroundingProvider,
  NoopMediaVerificationProvider,
} from './noopProviders';
import {
  HttpClaimExtractorProvider,
  HttpFactCheckProvider,
  HttpGroundingProvider,
  HttpMediaVerificationProvider,
} from './httpProviders';

let cachedProviders: VerificationProviders | null = null;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function readBaseUrl(): string | null {
  try {
    // import.meta.env is Vite-specific; guard for non-browser test environments
    const value =
      typeof import.meta !== 'undefined'
        ? (import.meta as any).env?.VITE_GLYMPSE_VERIFY_BASE_URL
        : undefined;
    if (typeof value !== 'string' || !value.trim()) return null;

    const normalized = value.trim().replace(/\/$/, '');
    try {
      const parsed = new URL(normalized);
      if (
        isLoopbackHost(parsed.hostname)
        && typeof window !== 'undefined'
        && !isLoopbackHost(window.location.hostname)
      ) {
        return null;
      }
    } catch {
      // Non-URL values are handled by downstream fetch and may be relative.
    }

    return normalized;
  } catch {
    return null;
  }
}

function readTimeoutMs(): number {
  try {
    const raw =
      typeof import.meta !== 'undefined'
        ? (import.meta as any).env?.VITE_GLYMPSE_VERIFY_TIMEOUT_MS
        : undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 6_000;
  } catch {
    return 6_000;
  }
}

/**
 * Returns a singleton VerificationProviders instance.
 * Falls back to heuristic/noop providers when VITE_GLYMPSE_VERIFY_BASE_URL
 * is not configured.
 */
export function createVerificationProviders(): VerificationProviders {
  if (cachedProviders !== null) return cachedProviders;

  const baseUrl = readBaseUrl();

  if (baseUrl === null) {
    cachedProviders = {
      claimExtractor: new HeuristicClaimExtractorProvider(),
      factCheck: new NoopFactCheckProvider(),
      grounding: new NoopGroundingProvider(),
      media: new NoopMediaVerificationProvider(),
    };
    return cachedProviders;
  }

  const timeoutMs = readTimeoutMs();
  cachedProviders = {
    claimExtractor: new HttpClaimExtractorProvider({ baseUrl, timeoutMs, retries: 2 }),
    factCheck: new HttpFactCheckProvider({ baseUrl, timeoutMs, retries: 2 }),
    grounding: new HttpGroundingProvider({ baseUrl, timeoutMs, retries: 2 }),
    media: new HttpMediaVerificationProvider({ baseUrl, timeoutMs, retries: 2 }),
  };
  return cachedProviders;
}

/**
 * Clears the cached providers — useful in tests or when env vars change.
 */
export function resetVerificationProviders(): void {
  cachedProviders = null;
}
