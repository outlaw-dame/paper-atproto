// ─── Native Android Back Button Handler ───────────────────────────────────────
// Implements the Android back button flow for Capacitor native builds:
//   1. Close top overlay (compose, story, search, etc.)
//   2. Navigate back in browser history
//   3. Minimize the app at root (prefer minimize over exit for social apps)
//
// Must be initialized once at startup via initNativeBackButton().
// Only activates on Android native — no-ops on iOS and web.

import { App } from '@capacitor/app';
import { isNativeAndroid } from './capacitorRuntime';

let initialized = false;

/** Callback that attempts to close the topmost overlay. Returns true if an overlay was closed. */
export type CloseTopOverlayFn = () => boolean;

let closeTopOverlay: CloseTopOverlayFn = () => false;

/**
 * Register the overlay-close function that the back button handler will call.
 * Typically wired to the UI store's overlay stack dismissal logic.
 */
export function setBackButtonOverlayHandler(handler: CloseTopOverlayFn): void {
  closeTopOverlay = handler;
}

/**
 * Initialize the native Android back button handler.
 *
 * The Capacitor App plugin's backButton listener replaces the system default
 * when `disableBackButtonHandler: true` is set in capacitor.config.ts.
 * This gives the app full control over back navigation.
 *
 * Safe to call multiple times — only initializes once.
 * No-ops on iOS and web.
 */
export async function initNativeBackButton(): Promise<void> {
  if (initialized || !isNativeAndroid()) return;
  initialized = true;

  await App.addListener('backButton', async () => {
    // 1. Try to close the top overlay (compose, story, modal, etc.)
    if (closeTopOverlay()) return;

    // 2. If there's browser history, go back.
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    // 3. At root with nothing to close — minimize rather than exit.
    // Social apps should stay resident for notification delivery.
    try {
      await App.minimizeApp();
    } catch {
      // minimizeApp() can fail on some Android builds; swallow silently.
    }
  });
}
