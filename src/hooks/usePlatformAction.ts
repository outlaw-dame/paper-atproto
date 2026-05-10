// ─── usePlatformAction ────────────────────────────────────────────────────────
// Abstracts platform-specific capability checks into reusable actions.
// Every "share" or "install" or "enable notifications" flow should go through here,
// not scattered throughout feature code.
//
// Pattern:
//   const shareAction = usePlatformAction('sharePost');
//   if (!shareAction.available) return null;
//   <button onClick={shareAction.run}>
//     <Icon name={shareAction.icon} />
//     {shareAction.label}
//   </button>

import { useCallback, useMemo } from 'react';
import { usePlatformRuntime } from '../platform/PlatformRuntimeContext';
import type { IconName } from '../components/native/NativeIcon';

// ─── Action types ─────────────────────────────────────────────────────────────

export type PlatformActionName =
  | 'sharePost'
  | 'copyLink'
  | 'installApp'
  | 'enableNotifications'
  | 'openBadgeSettings'
  | 'pickContact'
  | 'openExternalUri'
  | 'setThemeDark'
  | 'setThemeLight'
  | 'exportData'
  | 'importData';

/**
 * Data returned by usePlatformAction.
 * The action is considered "available" if the platform supports it.
 * "fallback" provides a degraded UX when native capability is unavailable.
 */
export interface PlatformAction {
  readonly available: boolean;
  readonly label: string;
  readonly description?: string;
  readonly icon: IconName;
  readonly run: () => Promise<void> | void;
  readonly fallback?: () => Promise<void> | void;
  readonly requiresUserGesture?: boolean;
}

// ─── Action factory ───────────────────────────────────────────────────────────

type ActionFactory = (runtime: ReturnType<typeof usePlatformRuntime>) => PlatformAction;

/**
 * Share the current post using Web Share API if available, else copy link.
 */
function createSharePostAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: runtime.capabilities.webShare,
    label: runtime.visualIdiom === 'material' ? 'Share' : 'Share',
    icon: 'share',
    requiresUserGesture: true,
    run: async () => {
      if (!runtime.capabilities.webShare) {
        throw new Error('Web Share not available');
      }
      try {
        const title = document.title || 'Paper';
        const url = window.location.href;
        await navigator.share({ title, url });
      } catch (error) {
        // User cancelled or error occurred; silently ignore
        if (error instanceof Error && error.name !== 'AbortError') {
          console.warn('[PlatformAction:sharePost]', error.message);
        }
      }
    },
    fallback: async () => {
      // Fallback: copy link to clipboard
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch (error) {
        console.warn('[PlatformAction:sharePost:fallback]', error);
      }
    },
  };
}

/**
 * Copy a link to clipboard.
 */
function createCopyLinkAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: true,
    label: 'Copy link',
    icon: 'link',
    run: async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch (error) {
        console.warn('[PlatformAction:copyLink]', error);
        throw new Error('Failed to copy link');
      }
    },
  };
}

/**
 * Install the app using platform-specific mechanics.
 */
function createInstallAppAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  const isStandalone = runtime.isInstalled;
  
  if (isStandalone) {
    return {
      available: false,
      label: 'Already installed',
      icon: 'check',
      run: () => {},
    };
  }

  if (runtime.visualIdiom === 'material') {
    // Android: relies on beforeinstallprompt event handler elsewhere
    return {
      available: true,
      label: 'Install app',
      icon: 'plus',
      requiresUserGesture: true,
      run: () => {
        // Dispatch event for AndroidEnhancementBridge to intercept
        window.dispatchEvent(new CustomEvent('paper:install-prompt-requested'));
      },
    };
  }

  // iOS/macOS: show instructions
  return {
    available: true,
    label: runtime.isMobile ? 'Add to Home Screen' : 'Add to Dock',
    icon: 'plus',
    run: async () => {
      // Show instructions sheet/modal
      window.dispatchEvent(new CustomEvent('paper:show-install-instructions'));
    },
  };
}

/**
 * Enable push notifications.
 */
function createEnableNotificationsAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: runtime.capabilities.notifications && runtime.capabilities.push,
    label: 'Enable notifications',
    icon: 'bell',
    requiresUserGesture: true,
    run: async () => {
      if (!runtime.capabilities.notifications) {
        throw new Error('Notifications not available');
      }
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Notification permission denied');
        }
        // Dispatch event for push subscription setup
        window.dispatchEvent(new CustomEvent('paper:notifications-enabled'));
      } catch (error) {
        console.warn('[PlatformAction:enableNotifications]', error);
        throw error;
      }
    },
  };
}

/**
 * Open the app badge settings (if badging is available).
 */
function createOpenBadgeSettingsAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: runtime.capabilities.badging,
    label: 'Badge settings',
    icon: 'settings',
    run: () => {
      window.dispatchEvent(new CustomEvent('paper:open-badge-settings'));
    },
  };
}

/**
 * Pick a contact using the Contact Picker API (Android primarily).
 */
function createPickContactAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: runtime.capabilities.contactPicker ?? false,
    label: 'Pick contact',
    icon: 'plus',
    requiresUserGesture: true,
    run: async () => {
      if (!('contacts' in navigator)) {
        throw new Error('Contact Picker not available');
      }
      try {
        // @ts-ignore - Contact Picker API is not yet in lib.dom.d.ts
        const contacts = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
        if (contacts.length === 0) return;
        window.dispatchEvent(new CustomEvent('paper:contact-picked', { detail: contacts[0] }));
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.warn('[PlatformAction:pickContact]', error);
        }
      }
    },
  };
}

/**
 * Open an external URI (protocol handler, e.g., nostr://).
 */
function createOpenExternalUriAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: true,
    label: 'Open link',
    icon: 'external-link',
    run: async (uri?: string) => {
      if (!uri) throw new Error('No URI provided');
      try {
        window.location.href = uri;
      } catch (error) {
        console.warn('[PlatformAction:openExternalUri]', error);
        throw error;
      }
    },
  };
}

/**
 * Export user data (local SQLite backup).
 */
function createExportDataAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: runtime.capabilities.fileSystemAccess ?? true,
    label: 'Export data',
    icon: 'link',
    run: async () => {
      window.dispatchEvent(new CustomEvent('paper:export-data-requested'));
    },
  };
}

/**
 * Import user data (restore from backup).
 */
function createImportDataAction(runtime: ReturnType<typeof usePlatformRuntime>): PlatformAction {
  return {
    available: true,
    label: 'Import data',
    icon: 'link',
    requiresUserGesture: true,
    run: async () => {
      window.dispatchEvent(new CustomEvent('paper:import-data-requested'));
    },
  };
}

/**
 * Set theme to dark mode.
 */
function createSetThemeDarkAction(): PlatformAction {
  return {
    available: true,
    label: 'Dark mode',
    icon: 'settings',
    run: async () => {
      window.dispatchEvent(new CustomEvent('paper:set-theme-dark'));
    },
  };
}

/**
 * Set theme to light mode.
 */
function createSetThemeLightAction(): PlatformAction {
  return {
    available: true,
    label: 'Light mode',
    icon: 'settings',
    run: async () => {
      window.dispatchEvent(new CustomEvent('paper:set-theme-light'));
    },
  };
}

// ─── Factory map ──────────────────────────────────────────────────────────────

const ACTION_FACTORIES: Record<PlatformActionName, ActionFactory> = {
  sharePost: createSharePostAction,
  copyLink: createCopyLinkAction,
  installApp: createInstallAppAction,
  enableNotifications: createEnableNotificationsAction,
  openBadgeSettings: createOpenBadgeSettingsAction,
  pickContact: createPickContactAction,
  openExternalUri: createOpenExternalUriAction,
  exportData: createExportDataAction,
  importData: createImportDataAction,
  setThemeDark: createSetThemeDarkAction,
  setThemeLight: createSetThemeLightAction,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook: get a platform action and execute it safely.
 * If the action is not available, returns an action with available=false.
 * Always safe to call; errors are caught and logged.
 */
export function usePlatformAction(name: PlatformActionName): PlatformAction {
  const runtime = usePlatformRuntime();

  const baseAction = useMemo(
    () => ACTION_FACTORIES[name]?.(runtime) ?? {
      available: false,
      label: 'Not available',
      icon: 'chevron-right' as IconName,
      run: () => {
        throw new Error(`Action "${name}" not found`);
      },
    },
    [name, runtime],
  );

  // Wrap run() to add safety: catch errors, dispatch result event
  const safeRun = useCallback(async (param?: unknown) => {
    try {
      if (!baseAction.available && baseAction.fallback) {
        await baseAction.fallback();
        return;
      }
      if (!baseAction.available) {
        console.warn(`[PlatformAction:${name}] Not available on this platform`);
        return;
      }
      // @ts-ignore - run may accept param depending on action
      await baseAction.run(param);
      // Dispatch success event for listeners
      window.dispatchEvent(new CustomEvent(`paper:action-${name}-success`));
    } catch (error) {
      console.error(`[PlatformAction:${name}]`, error);
      window.dispatchEvent(new CustomEvent(`paper:action-${name}-error`, { detail: error }));
      throw error;
    }
  }, [baseAction, name]);

  return {
    ...baseAction,
    run: safeRun,
  };
}
