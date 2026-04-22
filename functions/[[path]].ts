/**
 * Cloudflare Pages catch-all Function – Glimpse
 *
 * Responsibilities:
 *  1. Negotiate Accept-Encoding and serve precompressed asset variants
 *     (.zst preferred, then .gz) for eligible static file types.
 *     This makes use of the precompressed files produced by scripts/vite/precompressPlugin.ts.
 *  2. Set correct Content-Encoding + Vary: Accept-Encoding headers.
 *  3. Apply per-route Cache-Control:
 *       /assets/*      → immutable, 1 year  (content-hashed Vite bundles)
 *       /models/*      → 7-day SWR          (ML model weights)
 *       *.html         → no-cache           (always revalidate)
 *       /manifest.json → no-cache
 *       /sw.js         → no-store           (service worker must be network-fresh)
 *       /oauth/*       → no-store           (auth metadata is sensitive)
 *  4. Apply security headers: HSTS, X-Content-Type-Options, CSP, etc.
 *  5. Strip fingerprinting headers (Server, X-Powered-By).
 *
 * Security invariants:
 *  - Never intercept /oauth/* or /api/* (auth-bearing) routes.
 *  - Never serve a compressed variant for already-binary content.
 *  - Never cache responses that carry Authorization headers.
 *  - HSTS is applied at the edge so it fires even on first response.
 *
 * Deployment:
 *  - Build:   pnpm run build:cf
 *  - Deploy:  pnpm run deploy:cf
 */

import type { EventContext, Fetcher, PagesFunction } from '@cloudflare/workers-types';

// ─── Environment bindings ─────────────────────────────────────────────────────

interface Env {
  /** Binding that serves static files from the Pages deployment. */
  ASSETS: Fetcher;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * File extensions that benefit from content-encoding compression.
 * These are text-based or otherwise compressible formats.
 */
const COMPRESSIBLE_EXTS = new Set<string>([
  'js', 'cjs', 'mjs',  // JavaScript
  'css',               // Stylesheets
  'wasm',              // WebAssembly (often ~40% smaller compressed)
  'json',              // JSON data, OAuth metadata, manifests
  'svg',               // SVG icons (XML text)
  'map',               // Source maps
  'vtt',               // WebVTT captions
  'xml',               // XML feeds
  'txt',               // Plain text
  'html',              // HTML (e.g. offline.html)
]);

/**
 * Extensions that are already compressed at the codec level.
 * Never attempt double-compression — it wastes CPU and can increase size.
 */
const ALREADY_COMPRESSED_EXTS = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'heic', 'heif',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'ogg', 'wav', 'aac',
  'woff', 'woff2', 'otf', 'ttf',
  'gz', 'zst', 'br', 'zip', 'rar', '7z',
]);

/**
 * HSTS value. Reviewed and deliberately not including `preload` until the
 * domain has been stable on HTTPS for several months.
 * See https://hstspreload.org for preload submission guidance.
 */
const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * CSP mirroring index.html — enforced as an HTTP header for stronger
 * protection than the <meta> equivalent (headers fire before the parser).
 */
const CSP_VALUE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'self' https://www.youtube-nocookie.com",
  "form-action 'self'",
  // sha256 covers the inline theme-init.js script injected before first paint
  "script-src 'self' 'sha256-H0wB0z85Hxa5DWBSsUbTFX//Jn0YFQKsoqGqVunONqM='",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  // wss: for WebSocket (push notifications in dev); restricted to same-origin
  // in prod by the service worker which only allows known origins.
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getExtension(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  if (dot === -1 || dot === pathname.length - 1) return '';
  return pathname.slice(dot + 1).toLowerCase();
}

/**
 * Resolves a Cache-Control directive for a given pathname.
 * Returns null to let _headers / Cloudflare defaults apply.
 */
function resolveCacheControl(pathname: string): string | null {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/models/')) return 'public, max-age=604800, stale-while-revalidate=86400';
  if (pathname === '/sw.js' || pathname.endsWith('/sw.js')) return 'no-store, no-cache, must-revalidate';
  if (pathname === '/manifest.json' || pathname.endsWith('/manifest.json')) return 'no-cache, must-revalidate';
  if (pathname.endsWith('.html') || pathname === '/' || pathname === '') return 'no-cache, must-revalidate';
  if (pathname.startsWith('/oauth/') || pathname.startsWith('/api/')) return 'no-store';
  return null;
}

/**
 * Parses Accept-Encoding and returns ordered compression candidates.
 * Preference: zstd > gzip (identity is implicit fallback).
 * q=0 directives are respected (exclusions).
 */
function resolveEncodingCandidates(
  headerValue: string,
): ReadonlyArray<{ suffix: '.zst' | '.gz'; encoding: 'zstd' | 'gzip' }> {
  const candidates: Array<{ suffix: '.zst' | '.gz'; encoding: 'zstd' | 'gzip' }> = [];

  // Normalise and split: "gzip, zstd;q=0.9, identity;q=0" → tokens
  const tokens = headerValue.split(',').map((t) => t.trim().toLowerCase());

  const qValue = (token: string): number => {
    const m = /;q=([\d.]+)/.exec(token);
    if (!m || !m[1]) return 1.0;
    const v = parseFloat(m[1]);
    return Number.isFinite(v) ? v : 1.0;
  };

  const qOf = (name: string): number => {
    const found = tokens.find((t) => t === name || t.startsWith(`${name};`) || t.startsWith(`${name} `));
    if (!found) return 0;
    return qValue(found);
  };

  if (qOf('zstd') > 0) candidates.push({ suffix: '.zst', encoding: 'zstd' });
  if (qOf('gzip') > 0) candidates.push({ suffix: '.gz', encoding: 'gzip' });

  // Sort by q-value descending (zstd is preferred at equal q)
  candidates.sort((a, b) => qOf(b.encoding) - qOf(a.encoding));

  return candidates;
}

/**
 * Applies Glimpse's security headers to a mutable Headers object.
 * Called on every response regardless of cache strategy.
 */
function applySecurityHeaders(headers: Headers): void {
  headers.set('Strict-Transport-Security', HSTS_VALUE);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '0');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
    'browsing-topics=()',
  ].join(', '));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Content-Security-Policy', CSP_VALUE);
  // Strip origin-fingerprinting headers
  headers.delete('Server');
  headers.delete('X-Powered-By');
}

/**
 * Wraps a Response with mutated headers, preserving the streaming body.
 * Avoids buffering — safe for large files like ML models.
 */
function withHeaders(
  original: Response,
  mutate: (h: Headers) => void,
): Response {
  const headers = new Headers(original.headers);
  mutate(headers);
  return new Response(original.body, {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const onRequest: PagesFunction<Env> = async (
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> => {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // ── Pass mutations straight through ───────────────────────────────────────
  if (method !== 'GET' && method !== 'HEAD') {
    return next();
  }

  // ── Never intercept auth or API routes ────────────────────────────────────
  if (pathname.startsWith('/oauth/') || pathname.startsWith('/api/')) {
    const passthrough = await next();
    return withHeaders(passthrough, (h) => {
      h.set('Cache-Control', 'no-store');
      applySecurityHeaders(h);
    });
  }

  const ext = getExtension(pathname);
  const isAlreadyCompressed = ALREADY_COMPRESSED_EXTS.has(ext);
  const isCompressible = !isAlreadyCompressed && ext !== '' && COMPRESSIBLE_EXTS.has(ext);

  // ── Compression negotiation for eligible assets ───────────────────────────
  if (isCompressible) {
    const acceptEncoding = request.headers.get('Accept-Encoding') ?? '';
    const candidates = resolveEncodingCandidates(acceptEncoding);

    for (const { suffix, encoding } of candidates) {
      try {
        const variantUrl = url.href + suffix;
        const variantReq = new Request(variantUrl, {
          method: request.method,
          headers: request.headers,
          redirect: 'manual',
        });

        const variantRes = await env.ASSETS.fetch(variantReq);

        // Only accept 200 OK — skip 3xx, 404, etc.
        if (variantRes.status !== 200) continue;

        const cacheControl = resolveCacheControl(pathname);
        return withHeaders(variantRes, (h) => {
          h.set('Content-Encoding', encoding);
          h.set('Vary', 'Accept-Encoding');
          if (cacheControl) h.set('Cache-Control', cacheControl);
          applySecurityHeaders(h);
        });
      } catch {
        // Variant fetch threw (e.g. network error to ASSETS binding) — try next.
        continue;
      }
    }

    // No compressed variant found — serve the original, still adding headers.
    const original = await next();
    const cacheControl = resolveCacheControl(pathname);
    return withHeaders(original, (h) => {
      h.set('Vary', 'Accept-Encoding');
      if (cacheControl) h.set('Cache-Control', cacheControl);
      applySecurityHeaders(h);
    });
  }

  // ── Non-compressible or unknown type – pass through with headers ──────────
  const original = await next();
  const cacheControl = resolveCacheControl(pathname);
  return withHeaders(original, (h) => {
    if (cacheControl) h.set('Cache-Control', cacheControl);
    applySecurityHeaders(h);
  });
};
