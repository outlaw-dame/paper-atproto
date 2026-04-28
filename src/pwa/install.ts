// ─── Install / Standalone Detection ──────────────────────────────────────────
// Exposes install-related state without assuming a unified install prompt.
// iOS Safari uses a manual "Add to Home Screen" flow — no beforeinstallprompt.

export interface InstallState {
  /** True if running as an installed app (standalone or minimal-ui display mode). */
  standalone: boolean;
  /** True if the browser can show a native install prompt (Chromium only). */
  deferredPromptAvailable: boolean;
  /** True if on iOS Safari where only manual installation is possible. */
  isIosSafariInstallCandidate: boolean;
}

let _deferredPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

export function getInstallState(): InstallState {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { standalone: false, deferredPromptAvailable: false, isIosSafariInstallCandidate: false };
  }

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|chrome/i.test(ua);
  const isIosSafariInstallCandidate = isIos && isSafari && !standalone;

  return {
    standalone,
    deferredPromptAvailable: _deferredPrompt !== null,
    isIosSafariInstallCandidate,
  };
}

/** Trigger the native install prompt if available (Chromium only). */
export async function triggerInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!_deferredPrompt) return 'unavailable';
  try {
    await _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    return outcome;
  } catch {
    return 'unavailable';
  }
}
