// ─── Service Worker Message Channel ──────────────────────────────────────────
// Typed messages between the app (client) and the service worker.
/** Post a typed message to the active service worker. */
export function postToServiceWorker(msg) {
    try {
        const controller = navigator.serviceWorker?.controller;
        if (controller) {
            controller.postMessage(msg);
        }
    }
    catch {
        // Non-fatal — SW may not be active yet.
    }
}
/** Subscribe to messages from the service worker. Returns an unsubscribe fn. */
export function onServiceWorkerMessage(handler) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return () => { };
    }
    const listener = (event) => {
        try {
            const msg = event.data;
            if (!msg || typeof msg.type !== 'string')
                return;
            handler(msg);
        }
        catch {
            // Ignore malformed messages.
        }
    };
    navigator.serviceWorker.addEventListener('message', listener);
    return () => navigator.serviceWorker.removeEventListener('message', listener);
}
//# sourceMappingURL=serviceWorkerMessages.js.map