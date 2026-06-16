// ─── App Badge ────────────────────────────────────────────────────────────────
// Sync the unread count into the OS-level app badge.
// Source of truth is core app state — never Apple-only mirrors.
// No-ops silently on unsupported platforms.
//
// Priority (checked in order):
//   1. Capacitor native badge (iOS badge count via Push plugin, Android notification badge)
//   2. PWA Badging API (navigator.setAppBadge)
//   3. Service Worker message fallback (for contexts where API is SW-only)

import { postToServiceWorker } from '../serviceWorkerMessages';
import { isNativePlatform } from '../../native/capacitorRuntime';

let _pendingBadgeUpdate: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 300;

/** Sync unread badge count. Debounced to avoid churn. */
export function syncAppBadge(count: number): void {
  if (_pendingBadgeUpdate !== null) {
    clearTimeout(_pendingBadgeUpdate);
  }
  _pendingBadgeUpdate = setTimeout(() => {
    _pendingBadgeUpdate = null;
    const safe = Math.max(0, Math.floor(count));
    _setBadgeDirect(safe);
  }, DEBOUNCE_MS);
}

/** Clear the app badge immediately. */
export function clearAppBadgeSafe(): void {
  if (_pendingBadgeUpdate !== null) {
    clearTimeout(_pendingBadgeUpdate);
    _pendingBadgeUpdate = null;
  }
  _clearBadgeDirect();
}

function _setBadgeDirect(count: number): void {
  // On Capacitor native: use the Badge plugin if available.
  // iOS uses the app icon badge number; Android uses notification badge.
  if (isNativePlatform()) {
    void _setNativeBadge(count);
    return;
  }

  // Prefer the Badging API; fall back to SW message for contexts where the API
  // is only exposed inside the service worker.
  if ('setAppBadge' in navigator) {
    (navigator as Navigator & { setAppBadge(count?: number): Promise<void> })
      .setAppBadge(count || undefined)
      .catch(() => {});
    return;
  }

  // Fall back to a SW message so the SW can call self.setAppBadge.
  const nav = navigator as Navigator & { serviceWorker?: ServiceWorkerContainer };
  if (nav.serviceWorker?.controller) {
    postToServiceWorker({ type: 'SET_BADGE', count });
  }
}

function _clearBadgeDirect(): void {
  if (isNativePlatform()) {
    void _setNativeBadge(0);
    return;
  }

  if ('clearAppBadge' in navigator) {
    (navigator as Navigator & { clearAppBadge(): Promise<void> })
      .clearAppBadge()
      .catch(() => {});
    return;
  }

  const nav = navigator as Navigator & { serviceWorker?: ServiceWorkerContainer };
  if (nav.serviceWorker?.controller) {
    postToServiceWorker({ type: 'CLEAR_BADGE' });
  }
}

/**
 * Set the native app badge count via Capacitor.
 * Uses the PushNotifications plugin's setBadgeCount on iOS.
 * On Android, badge count is typically handled by the notification itself.
 */
async function _setNativeBadge(count: number): Promise<void> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // setBadgeCount is available on iOS; on Android it's a no-op or handled
    // by the notification channel.
    if ('setBadgeCount' in PushNotifications) {
      await (PushNotifications as typeof PushNotifications & {
        setBadgeCount(options: { count: number }): Promise<void>;
      }).setBadgeCount({ count });
    }
  } catch {
    // Badge setting is best-effort — never crash the app.
  }
}
