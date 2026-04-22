// ─── Service Worker Message Channel ──────────────────────────────────────────
// Typed messages between the app (client) and the service worker.

export type AppToSwMessage =
  | { type: 'SET_BADGE'; count: number }
  | { type: 'CLEAR_BADGE' }
  | { type: 'SKIP_WAITING' };

export type SwToAppMessage =
  | { type: 'UPDATE_READY' }
  | { type: 'CACHE_STATUS'; status: 'ok' | 'error' }
  | { type: 'NOTIFICATION_CLICK'; url: string };

/** Post a typed message to the active service worker. */
export function postToServiceWorker(msg: AppToSwMessage): void {
  try {
    const controller = navigator.serviceWorker?.controller;
    if (controller) {
      controller.postMessage(msg);
    }
  } catch {
    // Non-fatal — SW may not be active yet.
  }
}

/** Subscribe to messages from the service worker. Returns an unsubscribe fn. */
export function onServiceWorkerMessage(
  handler: (msg: SwToAppMessage) => void
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const listener = (event: MessageEvent) => {
    try {
      const controller = navigator.serviceWorker?.controller;
      if (controller && event.source !== controller) return;

      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      handler(msg as SwToAppMessage);
    } catch {
      // Ignore malformed messages.
    }
  };

  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
