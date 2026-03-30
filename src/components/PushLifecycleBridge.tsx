import React from 'react';
import { NOTIFICATION_CLICK_EVENT } from '../pwa/bootstrap';
import { getPushCapability } from '../pwa/push/pushCapability';
import { reconcilePushSubscription } from '../pwa/push/pushSubscription';
import { usePushPreferencesStore } from '../pwa/push/pushPreferencesStore';
import { useUiStore } from '../store/uiStore';

const APP_BASE_PATH = '/paper-atproto';

export default function PushLifecycleBridge() {
  const pushEnabled = usePushPreferencesStore((state) => state.enabled);
  const setPushEnabled = usePushPreferencesStore((state) => state.setEnabled);

  const reconcileSubscription = React.useEffectEvent(async () => {
    const capability = getPushCapability();

    if (!pushEnabled) {
      return;
    }

    if (!capability.supported) {
      return;
    }

    if (capability.permission === 'denied') {
      setPushEnabled(false);
      return;
    }

    if (capability.permission !== 'granted') {
      return;
    }

    const result = await reconcilePushSubscription();
    if (!result.ok && result.errorCode === 'permission-denied') {
      setPushEnabled(false);
    }
  });

  const routeDeepLink = React.useEffectEvent((href: string) => {
    const url = sanitizeAppUrl(href);
    if (!url) {
      return false;
    }

    const hashRoute = normalizeHashRoute(url.hash);
    const {
      setTab,
      closeStory,
      closeSearchStory,
      clearExploreSearch,
      closeCompose,
      closePromptComposer,
    } = useUiStore.getState();

    const resetTransientUi = () => {
      closeStory();
      closeSearchStory();
      clearExploreSearch();
      closeCompose();
      closePromptComposer();
    };

    if (hashRoute === '/' || hashRoute === '') {
      resetTransientUi();
      setTab('home');
      return true;
    }

    // The app shell does not have a dedicated messages tab yet, so route both
    // notifications and message-origin push taps into Activity.
    if (hashRoute === '/notifications' || hashRoute === '/messages') {
      resetTransientUi();
      setTab('activity');
      return true;
    }

    return false;
  });

  React.useEffect(() => {
    void reconcileSubscription();
  }, [pushEnabled, reconcileSubscription]);

  React.useEffect(() => {
    if (!pushEnabled) {
      return;
    }

    const handleOnline = () => {
      void reconcileSubscription();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void reconcileSubscription();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pushEnabled, reconcileSubscription]);

  React.useEffect(() => {
    void routeDeepLink(window.location.href);

    const handleHashChange = () => {
      void routeDeepLink(window.location.href);
    };

    const handleNotificationClick = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (typeof url !== 'string' || url.length === 0) {
        return;
      }

      if (!routeDeepLink(url)) {
        const safeUrl = sanitizeAppUrl(url);
        if (safeUrl) {
          window.location.assign(safeUrl.href);
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(NOTIFICATION_CLICK_EVENT, handleNotificationClick as EventListener);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener(NOTIFICATION_CLICK_EVENT, handleNotificationClick as EventListener);
    };
  }, [routeDeepLink]);

  return null;
}

function sanitizeAppUrl(href: string): URL | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }
    if (!url.pathname.startsWith(APP_BASE_PATH)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizeHashRoute(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) {
    return '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}
