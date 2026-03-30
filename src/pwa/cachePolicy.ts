// ─── Cache Policy ─────────────────────────────────────────────────────────────
// App-side mirror of the service worker cache policy.
// Used for UI decisions and safe fetch wrappers.
// Default is network-only unless a URL matches an explicit allowlist entry.

import type { CacheStrategy } from './types.js';

const CACHEABLE_SAME_ORIGIN_PATTERNS: RegExp[] = [
  /\/paper-atproto\/assets\/[^/]+\.(js|css)$/,
  /\/paper-atproto\/(manifest\.json|favicon\.svg|offline\.html|apple-touch-icon\.png)$/,
  /\/paper-atproto\/(icon-192|icon-512)\.png$/,
];

const AVATAR_ORIGINS = new Set([
  'https://cdn.bsky.app',
  'https://cdn.bsky.social',
]);

const NEVER_CACHE_PATTERNS: RegExp[] = [
  /\/oauth\//,
  /\/auth\//,
  /\/session/,
  /\/token/,
  /[?&]access_token=/,
  /[?&]code=/,
  /[?&]state=/,
];

export function getCacheStrategyForUrl(input: string): CacheStrategy {
  let url: URL;
  try {
    url = new URL(input, window.location.origin);
  } catch {
    return 'network-only';
  }

  // Never cache anything that looks auth-related.
  const full = url.href;
  if (NEVER_CACHE_PATTERNS.some((p) => p.test(full))) return 'network-only';

  // Shell assets: cache-first.
  if (
    url.origin === window.location.origin &&
    CACHEABLE_SAME_ORIGIN_PATTERNS.some((p) => p.test(url.pathname))
  ) {
    return 'cache-first';
  }

  // Avatars and images from known CDNs: stale-while-revalidate.
  if (AVATAR_ORIGINS.has(url.origin)) return 'stale-while-revalidate';

  return 'network-only';
}

export function isCacheableReadRequest(url: string): boolean {
  const strategy = getCacheStrategyForUrl(url);
  return strategy !== 'network-only';
}
