// ─── PWA Capability Detection ─────────────────────────────────────────────────
// Single source of truth for platform feature detection.
// Never throws — always returns a conservative capability object.

import type { PwaCapabilities } from './types';

export function detectPwaCapabilities(): PwaCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return conservativeCapabilities();
  }

  try {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    const serviceWorker = 'serviceWorker' in navigator;
    const push = serviceWorker && 'PushManager' in window;
    const notifications = 'Notification' in window;
    const badging = 'setAppBadge' in navigator || 'clearAppBadge' in navigator;
    const backgroundSync = serviceWorker && 'SyncManager' in window;

    const fileSystemWritable = (() => {
      try {
        return typeof (window as typeof window & { FileSystemWritableFileStream?: unknown }).FileSystemWritableFileStream !== 'undefined';
      } catch {
        return false;
      }
    })();

    const share = 'share' in navigator;

    // Detect WebKit/Safari using capability hints rather than UA sniffing.
    // The presence of navigator.standalone (even when undefined) is a reliable
    // WebKit signal on iOS; the absence of window.chrome is a coarse desktop hint.
    const isAppleWebKit = (() => {
      try {
        const hasStandaloneProp = 'standalone' in navigator;
        const noChrome = !('chrome' in window);
        const ua = navigator.userAgent;
        const uaIsWebKit = /webkit/i.test(ua) && !/chromium|chrome/i.test(ua);
        return (hasStandaloneProp && noChrome) || uaIsWebKit;
      } catch {
        return false;
      }
    })();

    return {
      standalone,
      serviceWorker,
      push,
      notifications,
      badging,
      backgroundSync,
      fileSystemWritable,
      share,
      isAppleWebKit,
    };
  } catch {
    return conservativeCapabilities();
  }
}

function conservativeCapabilities(): PwaCapabilities {
  return {
    standalone: false,
    serviceWorker: false,
    push: false,
    notifications: false,
    badging: false,
    backgroundSync: false,
    fileSystemWritable: false,
    share: false,
    isAppleWebKit: false,
  };
}
