// ─── Native Splash Screen ─────────────────────────────────────────────────────
// Controls the Capacitor splash screen on native platforms.
//
// The splash should only be hidden after the app shell is ready to render.
// Hiding too early shows a blank white screen; hiding too late feels slow.
//
// On web/PWA this is a no-op — browsers handle their own loading state.

import { SplashScreen } from '@capacitor/splash-screen';
import { isNativePlatform } from './capacitorRuntime';

let hidden = false;

/**
 * Hide the native splash screen.
 *
 * Call this once the app shell has rendered and is ready for interaction.
 * Typically after React mounts the root component and any critical data
 * has loaded (auth state, initial UI store hydration).
 *
 * Uses a short fade-out for visual polish.
 * Safe to call multiple times — only hides once.
 * No-op on web.
 */
export async function hideNativeSplash(): Promise<void> {
  if (hidden || !isNativePlatform()) return;
  hidden = true;

  try {
    await SplashScreen.hide({
      fadeOutDuration: 200,
    });
  } catch {
    // Splash screen hide should never block app flow.
  }
}

/**
 * Show the splash screen again (e.g., during a full-app reload or migration).
 * Rarely needed — only for catastrophic recovery flows.
 * No-op on web.
 */
export async function showNativeSplash(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    hidden = false;
    await SplashScreen.show({
      autoHide: false,
      showDuration: 0,
    });
  } catch {
    // Non-critical.
  }
}
