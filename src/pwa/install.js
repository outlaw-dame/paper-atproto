// ─── Install / Standalone Detection ──────────────────────────────────────────
// Exposes install-related state without assuming a unified install prompt.
// iOS Safari uses a manual "Add to Home Screen" flow — no beforeinstallprompt.
let _deferredPrompt = null;
if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        _deferredPrompt = e;
    });
}
export function getInstallState() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return { standalone: false, deferredPromptAvailable: false, isIosSafariInstallCandidate: false };
    }
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        navigator.standalone === true;
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
export async function triggerInstallPrompt() {
    if (!_deferredPrompt)
        return 'unavailable';
    try {
        await _deferredPrompt.prompt();
        const { outcome } = await _deferredPrompt.userChoice;
        _deferredPrompt = null;
        return outcome;
    }
    catch {
        return 'unavailable';
    }
}
//# sourceMappingURL=install.js.map