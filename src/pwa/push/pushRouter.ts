// ─── Push Notification Router ─────────────────────────────────────────────────
// Maps validated push payloads into app navigation and state refresh.
// Only same-origin deep links are allowed.

import type { PushPayload, PushKind } from './pushTypes';

export interface RoutedPushAction {
  navigateTo?: string | undefined;
  refreshKeys?: string[] | undefined;
  badgeCount?: number | undefined;
}

const BASE_PATH = '/paper-atproto';

const KIND_ROUTES: Record<PushKind, string> = {
  mention: `${BASE_PATH}/#/notifications`,
  reply: `${BASE_PATH}/#/notifications`,
  follow: `${BASE_PATH}/#/notifications`,
  dm: `${BASE_PATH}/#/messages`,
  moderation: `${BASE_PATH}/#/notifications`,
  digest: `${BASE_PATH}/#/`,
  system: `${BASE_PATH}/#/notifications`,
};

const KIND_REFRESH_KEYS: Partial<Record<PushKind, string[]>> = {
  mention: ['notifications'],
  reply: ['notifications'],
  follow: ['notifications'],
  dm: ['messages', 'notifications'],
};

export function routePushPayload(payload: PushPayload): RoutedPushAction {
  const safeUrl = payload.url ? sanitizeDeepLink(payload.url) : null;
  const defaultRoute = KIND_ROUTES[payload.kind] ?? `${BASE_PATH}/#/notifications`;

  return {
    navigateTo: safeUrl ?? defaultRoute,
    refreshKeys: KIND_REFRESH_KEYS[payload.kind] ?? [],
    badgeCount: payload.badgeCount,
  };
}

function sanitizeDeepLink(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin);
    // Only allow same-origin navigation.
    if (u.origin !== window.location.origin) return null;
    // Only allow paths under the app scope.
    if (!u.pathname.startsWith(BASE_PATH)) return null;
    return u.href;
  } catch {
    return null;
  }
}
