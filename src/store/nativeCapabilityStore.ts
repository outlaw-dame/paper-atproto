// ─── Native Capability Store ──────────────────────────────────────────────────
// Zustand store that tracks the detected native runtime capabilities.
// Detection-only — does NOT store sensitive data, tokens, or user info.
//
// Consumers can subscribe to know whether native plugins are available
// and conditionally render native-only UI or choose implementation paths.

import { create } from 'zustand';
import type { CapacitorPlatform } from '../native/capacitorRuntime';

export interface NativeCapabilityState {
  /** Whether the app is running inside a Capacitor native shell. */
  isNative: boolean;
  /** Current platform: 'web', 'ios', or 'android'. */
  platform: CapacitorPlatform;
  /** True once capability detection has completed. */
  ready: boolean;
  /** Per-plugin availability flags. */
  capabilities: {
    app: boolean;
    keyboard: boolean;
    haptics: boolean;
    share: boolean;
    push: boolean;
    browser: boolean;
    statusBar: boolean;
    network: boolean;
    splashScreen: boolean;
    device: boolean;
    preferences: boolean;
  };
  /** Update detected capabilities. Merges partial updates. */
  setDetectedCapabilities: (next: Partial<Omit<NativeCapabilityState, 'setDetectedCapabilities'>>) => void;
}

const DEFAULT_CAPABILITIES: NativeCapabilityState['capabilities'] = {
  app: false,
  keyboard: false,
  haptics: false,
  share: false,
  push: false,
  browser: false,
  statusBar: false,
  network: false,
  splashScreen: false,
  device: false,
  preferences: false,
};

export const useNativeCapabilityStore = create<NativeCapabilityState>()((set) => ({
  isNative: false,
  platform: 'web',
  ready: false,
  capabilities: { ...DEFAULT_CAPABILITIES },
  setDetectedCapabilities: (next) =>
    set((state) => ({
      ...state,
      ...next,
      capabilities: next.capabilities
        ? { ...state.capabilities, ...next.capabilities }
        : state.capabilities,
    })),
}));

/**
 * Populate the store with detected native capabilities.
 * Call once at app startup after Capacitor is initialized.
 * Safe to call on web — sets isNative: false and all caps to false.
 */
export function hydrateNativeCapabilities(): void {
  try {
    // Dynamic import avoids circular dependency at module load time.
    // These modules are safe to import synchronously because they're already
    // bundled — the dynamic form is just to break the static import cycle.
    import('../native/capacitorRuntime').then(({ getNativeRuntime }) => {
      import('../native/nativeCapabilities').then(({ detectNativeCapabilities }) => {
        const runtime = getNativeRuntime();
        const caps = detectNativeCapabilities();

        useNativeCapabilityStore.getState().setDetectedCapabilities({
          isNative: runtime.isNative,
          platform: runtime.platform,
          ready: true,
          capabilities: {
            app: caps.hasApp,
            keyboard: caps.hasKeyboard,
            haptics: caps.hasHaptics,
            share: caps.hasShare,
            push: caps.hasPushNotifications,
            browser: caps.hasBrowser,
            statusBar: caps.hasStatusBar,
            network: caps.hasNetwork,
            splashScreen: caps.hasSplashScreen,
            device: caps.hasDevice,
            preferences: caps.hasPreferences,
          },
        });
      }).catch(() => {
        useNativeCapabilityStore.getState().setDetectedCapabilities({ ready: true });
      });
    }).catch(() => {
      useNativeCapabilityStore.getState().setDetectedCapabilities({ ready: true });
    });
  } catch {
    // On web or if detection fails — mark as ready with defaults.
    useNativeCapabilityStore.getState().setDetectedCapabilities({ ready: true });
  }
}
