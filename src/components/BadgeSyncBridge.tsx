import React from 'react';
import { syncAppBadge, clearAppBadgeSafe } from '../pwa/badge/setBadge.js';
import { useAppCapabilityStore } from '../store/appCapabilityStore.js';
import { useUiStore } from '../store/uiStore.js';

export default function BadgeSyncBridge() {
  const capabilities = useAppCapabilityStore((state) => state.capabilities);
  const badgingSupported = capabilities?.badging === true || capabilities?.serviceWorker === true;

  React.useEffect(() => {
    if (!badgingSupported) {
      return;
    }

    const syncBadge = (count: number) => {
      if (count > 0) {
        syncAppBadge(count);
      } else {
        clearAppBadgeSafe();
      }
    };

    syncBadge(useUiStore.getState().unreadCount);

    const unsubscribe = useUiStore.subscribe((state, prevState) => {
      if (state.unreadCount === prevState.unreadCount) {
        return;
      }
      syncBadge(state.unreadCount);
    });

    return () => {
      unsubscribe();
    };
  }, [badgingSupported]);

  return null;
}
