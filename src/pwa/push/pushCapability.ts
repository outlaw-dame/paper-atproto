// ─── Push Capability Detection ────────────────────────────────────────────────

export interface PushCapability {
  supported: boolean;
  /** On iOS/iPadOS, push only works reliably in standalone mode. */
  installedContextPreferred: boolean;
  permission: NotificationPermission | 'unsupported';
}

export function getPushCapability(): PushCapability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, installedContextPreferred: false, permission: 'unsupported' };
  }

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    return { supported: false, installedContextPreferred: false, permission: 'unsupported' };
  }

  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  // On iOS/iPadOS, Web Push requires standalone (Home Screen) mode.
  const installedContextPreferred = isIos && !isStandalone;

  const permission = Notification.permission;

  return { supported, installedContextPreferred, permission };
}
