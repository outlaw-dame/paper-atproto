// ─── Apple Enhancement Availability ──────────────────────────────────────────
// Central feature gate for all Apple-specific enhancements.
// Returns false for uncertain or unavailable features.
// Never throws — failure here must never degrade core UX.

import type { AppleEnhancementAvailability } from './types.js';
import { canLoadCloudKitScript, isCloudKitLoaded } from './cloudkit/loader.js';

export function detectAppleEnhancementAvailability(): AppleEnhancementAvailability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return conservativeAvailability();
  }

  try {
    // CloudKit stays opt-in, but report "available" when the app is configured
    // to load it lazily rather than only when the script is already present.
    const cloudKitJsAvailable =
      isCloudKitLoaded() || canLoadCloudKitScript(window.location.origin);

    const pwaInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    const notificationsUsable =
      'Notification' in window &&
      Notification.permission === 'granted' &&
      'serviceWorker' in navigator &&
      'PushManager' in window;

    const badgingUsable =
      'setAppBadge' in navigator || 'clearAppBadge' in navigator;

    // WebKit detection: capability-first, UA as fallback only.
    const ua = navigator.userAgent;
    const likelyAppleWebKit =
      ('standalone' in navigator && !('chrome' in window)) ||
      (/webkit/i.test(ua) && !/chromium|chrome/i.test(ua));

    return {
      cloudKitJsAvailable,
      pwaInstalled,
      notificationsUsable,
      badgingUsable,
      likelyAppleWebKit,
    };
  } catch {
    return conservativeAvailability();
  }
}

function conservativeAvailability(): AppleEnhancementAvailability {
  return {
    cloudKitJsAvailable: false,
    pwaInstalled: false,
    notificationsUsable: false,
    badgingUsable: false,
    likelyAppleWebKit: false,
  };
}
