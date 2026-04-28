// ─── Platform Bootstrap ───────────────────────────────────────────────────────
// Initializes capability detection, service worker registration, offline state,
// and message wiring. This runs in the background and must never block app boot.

import { useAppCapabilityStore } from '../store/appCapabilityStore';
import { useOfflineStatusStore } from '../store/offlineStatusStore';
import { detectPwaCapabilities } from './capabilities';
import { startNetworkHealthPolling } from './offline/networkHealth';
import { getOfflineState, subscribeOfflineState } from './offline/offlineState';
import { onServiceWorkerUpdate, registerAppServiceWorker } from './registerServiceWorker';
import { onServiceWorkerMessage } from './serviceWorkerMessages';

export const NOTIFICATION_CLICK_EVENT = 'paper:notification-click';

let bootstrapPromise: Promise<void> | null = null;
let stopHealthPolling: (() => void) | null = null;

export async function initPlatformBootstrap(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = doInit().catch((error) => {
    bootstrapPromise = null;
    throw error;
  });

  return bootstrapPromise;
}

async function doInit(): Promise<void> {
  const caps = detectPwaCapabilities();
  useAppCapabilityStore.getState().setCapabilities(caps);

  if (caps.serviceWorker) {
    const swState = await registerAppServiceWorker();
    useAppCapabilityStore.getState().setSwState(swState);
    onServiceWorkerUpdate(() => {
      useAppCapabilityStore.getState().setUpdateAvailable();
    });
  }

  syncOfflineState(getOfflineState());
  subscribeOfflineState((state) => {
    syncOfflineState(state);
  });

  onServiceWorkerMessage((msg) => {
    if (msg.type === 'NOTIFICATION_CLICK' && typeof msg.url === 'string') {
      window.dispatchEvent(
        new CustomEvent<string>(NOTIFICATION_CLICK_EVENT, {
          detail: msg.url,
        }),
      );
    }
  });

  if (stopHealthPolling === null) {
    scheduleHealthPolling();
  }
}

function syncOfflineState(state: {
  network: 'online' | 'offline' | 'degraded';
  lastOnlineAt?: string;
  lastOfflineAt?: string;
}): void {
  useOfflineStatusStore.getState().setNetwork(state.network, {
    ...(state.lastOnlineAt ? { onlineAt: state.lastOnlineAt } : {}),
    ...(state.lastOfflineAt ? { offlineAt: state.lastOfflineAt } : {}),
  });
}

function scheduleHealthPolling(): void {
  const startPolling = () => {
    if (stopHealthPolling !== null) {
      return;
    }
    stopHealthPolling = startNetworkHealthPolling();
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(startPolling, { timeout: 8000 });
  } else {
    setTimeout(startPolling, 4000);
  }
}
