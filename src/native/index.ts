// ─── Native Bridge Layer ──────────────────────────────────────────────────────
// Single entry point for initializing all Capacitor native bridges.
//
// Call initNativeBridges() once at app startup (e.g., in main.tsx after
// React mounts). On web/PWA this is a fast no-op — all bridge modules
// guard themselves with isNativePlatform() checks.
//
// This module also re-exports everything for convenient imports:
//   import { nativeHaptic, shareUrl, isNativePlatform } from '../native';

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { getNativeRuntime, isNativePlatform, isNativeIOS, isNativeAndroid } from './capacitorRuntime';
export type { NativeRuntime, CapacitorPlatform } from './capacitorRuntime';

export { detectNativeCapabilities } from './nativeCapabilities';
export type { NativeCapabilityMap } from './nativeCapabilities';

export { initNativeAppBridge, setNativeAppLifecycleHandlers } from './nativeAppBridge';
export type { NativeAppLifecycleHandlers } from './nativeAppBridge';

export { initNativeBackButton, setBackButtonOverlayHandler } from './nativeBackButton';
export type { CloseTopOverlayFn } from './nativeBackButton';

export { nativeHaptic, hapticSelection, hapticLight, hapticSuccess } from './nativeHaptics';
export type { NativeHapticKind } from './nativeHaptics';

export { shareUrl } from './nativeShare';
export type { ShareInput, ShareResult } from './nativeShare';

export { openExternalUrl, closeExternalBrowser } from './nativeBrowser';

export { initNativeKeyboardBridge, getKeyboardHeight } from './nativeKeyboard';

export { configureNativeStatusBar, showStatusBar, hideStatusBar } from './nativeStatusBar';
export type { StatusBarTheme } from './nativeStatusBar';

export { hideNativeSplash, showNativeSplash } from './nativeSplash';

export { setPreference, getPreference, removePreference, clearAllPreferences } from './nativePreferences';

export { initNativeNetworkBridge, getNetworkState, onNetworkChange } from './nativeNetwork';
export type { NetworkState, NetworkChangeHandler } from './nativeNetwork';

export {
  initNativePushListeners,
  setNativePushHandlers,
  checkNativePushPermission,
  requestNativePushPermission,
  unregisterNativePush,
  clearNativeNotifications,
} from './nativePush';
export type { NativePushToken, NativePushHandlers } from './nativePush';

export { getPushChannel, isPushAvailable } from './pushRuntime';
export type { PushChannel } from './pushRuntime';

// ─── Initialization ───────────────────────────────────────────────────────────

import { isNativePlatform } from './capacitorRuntime';
import { initNativeAppBridge } from './nativeAppBridge';
import { initNativeBackButton } from './nativeBackButton';
import { initNativeKeyboardBridge } from './nativeKeyboard';
import { configureNativeStatusBar } from './nativeStatusBar';
import { initNativePushListeners } from './nativePush';
import { initNativeNetworkBridge } from './nativeNetwork';

/**
 * Initialize all native bridges.
 *
 * Call once at app startup. On web/PWA this completes immediately as a no-op.
 * Each bridge module is independently guarded — partial failures do not
 * prevent other bridges from initializing.
 *
 * Order matters:
 *   1. Status bar (visual — user sees this immediately)
 *   2. Keyboard (layout — affects rendering)
 *   3. Network (connectivity — affects data decisions)
 *   4. App lifecycle (events — needs to be ready for deep links)
 *   5. Back button (Android navigation)
 *   6. Push listeners (notification handling)
 */
export async function initNativeBridges(): Promise<void> {
  if (!isNativePlatform()) {
    // Even on web, initialize network bridge for online/offline events.
    try { await initNativeNetworkBridge(); } catch { /* non-critical */ }
    return;
  }

  // Each init is wrapped individually so one failure doesn't block the rest.
  const inits = [
    configureNativeStatusBar,
    initNativeKeyboardBridge,
    initNativeNetworkBridge,
    initNativeAppBridge,
    initNativeBackButton,
    initNativePushListeners,
  ];

  for (const init of inits) {
    try {
      await init();
    } catch (err: unknown) {
      // Log but never crash — native bridges are progressive enhancement.
      console.warn('[NativeBridge] Init failed:', (err as Error)?.message ?? 'unknown');
    }
  }
}
