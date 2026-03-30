// ─── Push Capability Detection ────────────────────────────────────────────────
export function getPushCapability() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return { supported: false, installedContextPreferred: false, permission: 'unsupported' };
    }
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
        return { supported: false, installedContextPreferred: false, permission: 'unsupported' };
    }
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        navigator.standalone === true;
    // On iOS/iPadOS, Web Push requires standalone (Home Screen) mode.
    const installedContextPreferred = isIos && !isStandalone;
    const permission = Notification.permission;
    return { supported, installedContextPreferred, permission };
}
//# sourceMappingURL=pushCapability.js.map