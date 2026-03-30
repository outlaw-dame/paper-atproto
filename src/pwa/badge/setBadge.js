// ─── App Badge ────────────────────────────────────────────────────────────────
// Sync the unread count into the OS-level app badge.
// Source of truth is core app state — never Apple-only mirrors.
// No-ops silently on unsupported platforms.
import { postToServiceWorker } from '../serviceWorkerMessages.js';
let _pendingBadgeUpdate = null;
const DEBOUNCE_MS = 300;
/** Sync unread badge count. Debounced to avoid churn. */
export function syncAppBadge(count) {
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
export function clearAppBadgeSafe() {
    if (_pendingBadgeUpdate !== null) {
        clearTimeout(_pendingBadgeUpdate);
        _pendingBadgeUpdate = null;
    }
    _clearBadgeDirect();
}
function _setBadgeDirect(count) {
    // Prefer the Badging API; fall back to SW message for contexts where the API
    // is only exposed inside the service worker.
    if ('setAppBadge' in navigator) {
        navigator
            .setAppBadge(count || undefined)
            .catch(() => { });
        return;
    }
    // Fall back to a SW message so the SW can call self.setAppBadge.
    const nav = navigator;
    if (nav.serviceWorker?.controller) {
        postToServiceWorker({ type: 'SET_BADGE', count });
    }
}
function _clearBadgeDirect() {
    if ('clearAppBadge' in navigator) {
        navigator
            .clearAppBadge()
            .catch(() => { });
        return;
    }
    const nav = navigator;
    if (nav.serviceWorker?.controller) {
        postToServiceWorker({ type: 'CLEAR_BADGE' });
    }
}
//# sourceMappingURL=setBadge.js.map