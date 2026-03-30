// ─── Offline State ────────────────────────────────────────────────────────────
// Observable online/offline/degraded state.
// Does NOT claim "online" from navigator.onLine alone — requires actual probe confirmation.
let _state = {
    network: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
};
const _listeners = new Set();
function notify() {
    _listeners.forEach((fn) => fn({ ..._state }));
}
function setState(partial) {
    _state = { ..._state, ...partial };
    notify();
}
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        setState({ network: 'online', lastOnlineAt: new Date().toISOString() });
    });
    window.addEventListener('offline', () => {
        setState({ network: 'offline', lastOfflineAt: new Date().toISOString() });
    });
}
export function getOfflineState() {
    return { ..._state };
}
export function subscribeOfflineState(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
}
/** Called by networkHealth probe to update degraded/online status. */
export function applyNetworkHealthResult(result) {
    const now = new Date().toISOString();
    if (result === 'online') {
        setState({ network: 'online', lastOnlineAt: now });
    }
    else if (result === 'degraded') {
        setState({ network: 'degraded' });
    }
    else {
        setState({ network: 'offline', lastOfflineAt: now });
    }
}
//# sourceMappingURL=offlineState.js.map