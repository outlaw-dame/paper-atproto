// ─── Push Runtime Dispatcher ──────────────────────────────────────────────────
// Decides whether to use native push (Capacitor APNs/FCM) or web push
// (Service Worker + Web Push API) based on the current runtime.
//
// Browser PWA → web push (existing sw.js push handler)
// Capacitor iOS → native push via APNs
// Capacitor Android → native push via FCM
//
// This separation is important because:
// - Token formats are different (APNs device token vs FCM registration token vs web push subscription)
// - Registration flows are different
// - The backend needs to know which delivery channel to use

import { isNativePlatform } from './capacitorRuntime';

export type PushChannel = 'native-apns' | 'native-fcm' | 'web-push' | 'none';

/**
 * Determine the appropriate push notification channel for the current runtime.
 */
export function getPushChannel(): PushChannel {
  if (isNativePlatform()) {
    const w = globalThis as typeof globalThis & {
      Capacitor?: { getPlatform?: () => string };
    };
    const platform = w.Capacitor?.getPlatform?.();
    if (platform === 'ios') return 'native-apns';
    if (platform === 'android') return 'native-fcm';
    return 'none';
  }

  // Check if web push is available via service worker.
  if (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  ) {
    return 'web-push';
  }

  return 'none';
}

/**
 * Returns true if any push channel is available for the current runtime.
 */
export function isPushAvailable(): boolean {
  return getPushChannel() !== 'none';
}
