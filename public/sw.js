/**
 * Glimpse Service Worker
 *
 * Responsibilities:
 *  - Precache app shell assets
 *  - Runtime cache images/avatars with stale-while-revalidate
 *  - Network-first for freshness-sensitive feed/API requests
 *  - Offline fallback to /paper-atproto/offline.html
 *  - Handle Web Push events and route notifications
 *  - Receive badge-update messages from the app
 *
 * Security rules:
 *  - Never cache auth tokens or Authorization-bearing responses
 *  - Never cache POST/PUT/PATCH/DELETE bodies
 *  - Never store raw push payloads in cache
 *  - Sanitize notification content before display
 *  - Only cache same-origin or explicitly allowed CDN origins
 */

'use strict';

const CACHE_VERSION = 'v2';

const SHELL_CACHE    = `glimpse-shell-${CACHE_VERSION}`;
const IMAGES_CACHE   = `glimpse-images-${CACHE_VERSION}`;
const AVATARS_CACHE  = `glimpse-avatars-${CACHE_VERSION}`;
const FEED_CACHE     = `glimpse-feed-${CACHE_VERSION}`;
const PREVIEWS_CACHE = `glimpse-safe-previews-${CACHE_VERSION}`;

const ALL_CACHES = [SHELL_CACHE, IMAGES_CACHE, AVATARS_CACHE, FEED_CACHE, PREVIEWS_CACHE];

const BASE_PATH = getBasePath();
const OFFLINE_URL = pathFor('offline.html');

// App shell assets to precache on install.
const SHELL_URLS = [
  pathFor(''),
  OFFLINE_URL,
  pathFor('manifest.json'),
  pathFor('favicon.svg'),
];

// CDN origins allowed for avatar/image caching.
const ALLOWED_IMAGE_ORIGINS = new Set([
  self.location.origin,
  'https://cdn.bsky.app',
  'https://cdn.bsky.social',
]);

// Notification icon/image URL allowlist (same-origin only for now).
const ALLOWED_NOTIFICATION_IMAGE_ORIGINS = new Set([
  self.location.origin,
  'https://cdn.bsky.app',
  'https://cdn.bsky.social',
]);

// Cache size limits.
const AVATAR_CACHE_MAX_ENTRIES = 200;
const IMAGES_CACHE_MAX_ENTRIES = 100;
const PREVIEWS_CACHE_MAX_ENTRIES = 50;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS.map((u) => new Request(u, { credentials: 'same-origin' }))))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Install cache error (non-fatal):', err?.message ?? 'unknown'))
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !ALL_CACHES.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  try {
    const { request } = event;

    // Only handle GET and HEAD.
    if (request.method !== 'GET' && request.method !== 'HEAD') return;

    const url = new URL(request.url);

    // Never intercept non-http(s) schemes.
    if (!url.protocol.startsWith('http')) return;

    // Never intercept browser-extension URLs.
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') return;

    // Auth endpoints: network-only, no caching.
    if (isAuthEndpoint(url)) return;

    // App shell: cache-first.
    if (isShellAsset(url)) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }

    // Avatar URLs: stale-while-revalidate with entry cap.
    if (isAvatarUrl(url)) {
      event.respondWith(staleWhileRevalidate(request, AVATARS_CACHE, AVATAR_CACHE_MAX_ENTRIES));
      return;
    }

    // Safe image/media assets from allowed origins: stale-while-revalidate.
    if (isAllowedImageAsset(url)) {
      event.respondWith(staleWhileRevalidate(request, IMAGES_CACHE, IMAGES_CACHE_MAX_ENTRIES));
      return;
    }

    // Safe OG/preview metadata from allowed origins: stale-while-revalidate.
    if (isSafePreviewAsset(url)) {
      event.respondWith(staleWhileRevalidate(request, PREVIEWS_CACHE, PREVIEWS_CACHE_MAX_ENTRIES));
      return;
    }

    // Same-origin navigation: network-first with offline fallback.
    if (request.mode === 'navigate' && url.origin === self.location.origin) {
      event.respondWith(networkFirstWithOfflineFallback(request));
      return;
    }

    // Everything else: network-only (don't risk caching something sensitive).
  } catch (err) {
    console.warn('[SW] Fetch handler error:', err?.message ?? 'unknown');
  }
});

// ─── Cache strategies ─────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const fallback = await caches.match(OFFLINE_URL);
    return fallback ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchAndStore = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        await evictOldEntries(cache, maxEntries);
      }
      return response;
    })
    .catch(() => null);

  return cached ?? (await fetchAndStore) ?? new Response('', { status: 204 });
}

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function isCacheableResponse(response) {
  return response && response.ok && response.status === 200;
}

async function evictOldEntries(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const toDelete = keys.slice(0, keys.length - maxEntries);
      await Promise.all(toDelete.map((k) => cache.delete(k)));
    }
  } catch {
    // Non-fatal.
  }
}

// ─── URL classification ───────────────────────────────────────────────────────

function isAuthEndpoint(url) {
  const p = url.pathname;
  return (
    p.includes('/oauth/') ||
    p.includes('/auth/') ||
    p.includes('/session') ||
    p.includes('/token') ||
    url.searchParams.has('access_token') ||
    url.searchParams.has('code')
  );
}

function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  const assetsPattern = new RegExp(`^${escapeRegex(pathFor('assets/'))}[^/]+\\.(js|css)$`);
  // Versioned JS/CSS bundles and core shell files.
  return (
    p === pathFor('') ||
    p === pathFor('index.html') ||
    p === pathFor('offline.html') ||
    p === pathFor('manifest.json') ||
    p === pathFor('favicon.svg') ||
    assetsPattern.test(p)
  );
}

function getBasePath() {
  try {
    const scope = self.registration?.scope;
    if (scope) {
      const parsed = new URL(scope);
      return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
    }
  } catch {
    // Fall through to root.
  }
  return '/';
}

function pathFor(relativePath) {
  if (!relativePath) return BASE_PATH;
  return `${BASE_PATH}${relativePath.replace(/^\//, '')}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAvatarUrl(url) {
  if (!ALLOWED_IMAGE_ORIGINS.has(url.origin)) return false;
  return url.pathname.includes('/img/avatar') || url.pathname.includes('/avatar/');
}

function isAllowedImageAsset(url) {
  if (!ALLOWED_IMAGE_ORIGINS.has(url.origin)) return false;
  return /\.(png|jpg|jpeg|gif|webp|avif|svg)(\?|$)/i.test(url.pathname);
}

function isSafePreviewAsset(url) {
  if (!ALLOWED_IMAGE_ORIGINS.has(url.origin)) return false;
  return url.pathname.includes('/img/feed_thumbnail') || url.pathname.includes('/img/feed_fullsize');
}

// ─── Push ─────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  try {
    const payload = parsePushPayload(event.data);
    if (!payload) return;

    const { title, body, url, iconUrl, imageUrl, badgeCount } = payload;

    const notificationOptions = {
      body: body ?? '',
      icon: sanitizeNotificationImageUrl(iconUrl) ?? pathFor('apple-touch-icon.png'),
      image: sanitizeNotificationImageUrl(imageUrl) ?? undefined,
      badge: pathFor('apple-touch-icon.png'),
      data: { url: sanitizeNotificationUrl(url), badgeCount },
      tag: payload.collapseKey ?? payload.kind,
      renotify: !payload.collapseKey,
    };

    event.waitUntil(
      self.registration.showNotification(truncate(title, 80), notificationOptions)
        .catch((err) => console.warn('[SW] showNotification failed:', err?.message))
    );
  } catch (err) {
    console.warn('[SW] Push handler error:', err?.message ?? 'unknown');
  }
});

self.addEventListener('notificationclick', (event) => {
  try {
    event.notification.close();
    const data = event.notification.data;
    const targetUrl = sanitizeNotificationUrl(data?.url) ?? pathFor('');

    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      }).catch((err) => console.warn('[SW] notificationclick routing error:', err?.message))
    );
  } catch (err) {
    console.warn('[SW] notificationclick handler error:', err?.message ?? 'unknown');
  }
});

// ─── Push helpers ─────────────────────────────────────────────────────────────

const VALID_PUSH_KINDS = new Set(['mention', 'reply', 'follow', 'dm', 'moderation', 'digest', 'system']);

function parsePushPayload(data) {
  if (!data) return null;
  try {
    const raw = data.json();
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version !== 1) return null;
    if (!raw.kind || !VALID_PUSH_KINDS.has(raw.kind)) return null;
    if (!raw.title || typeof raw.title !== 'string') return null;
    return {
      version: 1,
      kind: raw.kind,
      title: sanitizeText(String(raw.title)),
      body: raw.body ? sanitizeText(String(raw.body)) : undefined,
      url: raw.url ? String(raw.url) : undefined,
      badgeCount: typeof raw.badgeCount === 'number' ? Math.max(0, Math.floor(raw.badgeCount)) : undefined,
      iconUrl: raw.iconUrl ? String(raw.iconUrl) : undefined,
      imageUrl: raw.imageUrl ? String(raw.imageUrl) : undefined,
      collapseKey: raw.collapseKey ? String(raw.collapseKey) : undefined,
      receivedAt: raw.receivedAt ? String(raw.receivedAt) : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function sanitizeText(s) {
  return s.replace(/<[^>]*>/g, '').trim().slice(0, 200);
}

function sanitizeNotificationUrl(url) {
  const baseRoot = BASE_PATH === '/' ? '/' : BASE_PATH.replace(/\/$/, '');
  if (!url) return null;
  try {
    const u = new URL(url, self.location.origin);
    if (u.origin !== self.location.origin) return pathFor('');
    if (baseRoot !== '/' && u.pathname !== baseRoot && !u.pathname.startsWith(`${baseRoot}/`)) return pathFor('');
    return u.href;
  } catch {
    return pathFor('');
  }
}

function sanitizeNotificationImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!ALLOWED_NOTIFICATION_IMAGE_ORIGINS.has(u.origin)) return null;
    if (!/^https:/.test(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

function truncate(s, max) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// ─── Message channel ──────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  try {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'SET_BADGE':
        if ('setAppBadge' in self && typeof msg.count === 'number') {
          const count = Math.max(0, Math.floor(msg.count));
          self.setAppBadge(count || undefined).catch(() => {});
        }
        break;
      case 'CLEAR_BADGE':
        if ('clearAppBadge' in self) {
          self.clearAppBadge().catch(() => {});
        }
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn('[SW] Message handler error:', err?.message ?? 'unknown');
  }
});
