// ─── Native Capability Detection ──────────────────────────────────────────────
// Checks availability of individual Capacitor plugins at runtime.
// Use this to guard plugin calls — never assume a plugin is present just
// because the package is installed; plugin registration can fail.

import { Capacitor } from '@capacitor/core';
import { isNativePlatform } from './capacitorRuntime';

export interface NativeCapabilityMap {
  readonly isNative: boolean;
  readonly hasApp: boolean;
  readonly hasStatusBar: boolean;
  readonly hasSplashScreen: boolean;
  readonly hasKeyboard: boolean;
  readonly hasHaptics: boolean;
  readonly hasPreferences: boolean;
  readonly hasPushNotifications: boolean;
  readonly hasBrowser: boolean;
  readonly hasShare: boolean;
  readonly hasDevice: boolean;
  readonly hasNetwork: boolean;
}

function isPluginAvailable(name: string): boolean {
  try {
    return Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}

/**
 * Returns a snapshot of which Capacitor plugins are available at runtime.
 * All values are false on web/PWA. Safe to call at any time — never throws.
 */
export function detectNativeCapabilities(): NativeCapabilityMap {
  if (!isNativePlatform()) {
    return {
      isNative: false,
      hasApp: false,
      hasStatusBar: false,
      hasSplashScreen: false,
      hasKeyboard: false,
      hasHaptics: false,
      hasPreferences: false,
      hasPushNotifications: false,
      hasBrowser: false,
      hasShare: false,
      hasDevice: false,
      hasNetwork: false,
    };
  }

  return {
    isNative: true,
    hasApp: isPluginAvailable('App'),
    hasStatusBar: isPluginAvailable('StatusBar'),
    hasSplashScreen: isPluginAvailable('SplashScreen'),
    hasKeyboard: isPluginAvailable('Keyboard'),
    hasHaptics: isPluginAvailable('Haptics'),
    hasPreferences: isPluginAvailable('Preferences'),
    hasPushNotifications: isPluginAvailable('PushNotifications'),
    hasBrowser: isPluginAvailable('Browser'),
    hasShare: isPluginAvailable('Share'),
    hasDevice: isPluginAvailable('Device'),
    hasNetwork: isPluginAvailable('Network'),
  };
}
