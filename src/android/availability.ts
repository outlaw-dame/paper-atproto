// ─── Android Enhancement Availability ────────────────────────────────────────
// Central feature gate for all Android-specific enhancements.
// Returns false for uncertain or unavailable features.
// Never throws — failure here must never degrade core UX.
//
// Detection strategy (priority order):
//   1. Capability-first: check for the actual browser API
//   2. userAgentData.platform (structured UA — Chrome 90+)
//   3. UA string as last resort

import type { AndroidEnhancementAvailability } from './types';

// Extend Navigator to include non-standard APIs present in Android Chrome.
interface NavigatorAndroid extends Navigator {
  readonly userAgentData?: { readonly platform?: string; readonly mobile?: boolean };
  readonly contacts?: unknown; // ContactsManager — type checked at runtime
}

export function detectAndroidEnhancementAvailability(): AndroidEnhancementAvailability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return conservativeAvailability();
  }

  try {
    const nav = navigator as NavigatorAndroid;

    // ── API capability checks ─────────────────────────────────────────────
    // Web Share API — Android Chrome 61+, iOS Safari 15+, NOT desktop Safari.
    const shareApiAvailable = 'share' in navigator;

    // Vibration API — Android Chrome 32+; absent on iOS, Firefox for iOS,
    // and Safari. The strongest single Android-only capability signal.
    const vibrationApiAvailable = 'vibrate' in navigator;

    // Contact Picker — Android Chrome 80+ only; not on iOS, not on desktop.
    const contactPickerAvailable = 'contacts' in nav;

    // Badging API — Chrome 81+ (Android + desktop), Safari 17.4 (iOS/macOS).
    const badgingUsable =
      'setAppBadge' in navigator || 'clearAppBadge' in navigator;

    // Web Push + Service Worker
    const notificationsUsable =
      'Notification' in window &&
      Notification.permission === 'granted' &&
      'serviceWorker' in navigator &&
      'PushManager' in window;

    // History API back-gesture interception
    const backGestureSupported = typeof history !== 'undefined' &&
      typeof history.pushState === 'function';

    // File System Access API — Chrome 86+, Edge 86+; absent on Firefox/Safari.
    const filePickerAvailable = 'showOpenFilePicker' in window;

    // PWA installed as standalone or TWA
    const pwaInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches;

    // ── Android Chrome detection (capability-first) ────────────────────────
    // userAgentData is Chrome 90+ — the most reliable structured signal.
    const uadPlatform =
      typeof nav.userAgentData?.platform === 'string'
        ? nav.userAgentData.platform.toLowerCase()
        : '';

    const fromUad = uadPlatform.includes('android');

    // Capability fallback: require a strongly Android-specific pair of APIs.
    // Vibration alone is not sufficient because desktop Chromium also exposes
    // navigator.vibrate. Contact Picker remains Android Chrome-specific.
    const fromCapabilities =
      vibrationApiAvailable &&
      contactPickerAvailable &&
      'chrome' in window;

    // UA fallback — lowest priority.
    const fromUa = /android/i.test(navigator.userAgent);

    const likelyAndroidChrome = fromUad || fromCapabilities || fromUa;

    return {
      shareApiAvailable,
      vibrationApiAvailable,
      contactPickerAvailable,
      badgingUsable,
      notificationsUsable,
      backGestureSupported,
      filePickerAvailable,
      pwaInstalled,
      likelyAndroidChrome,
    };
  } catch {
    return conservativeAvailability();
  }
}

function conservativeAvailability(): AndroidEnhancementAvailability {
  return {
    shareApiAvailable: false,
    vibrationApiAvailable: false,
    contactPickerAvailable: false,
    badgingUsable: false,
    notificationsUsable: false,
    backGestureSupported: false,
    filePickerAvailable: false,
    pwaInstalled: false,
    likelyAndroidChrome: false,
  };
}
