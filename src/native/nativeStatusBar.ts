// ─── Native Status Bar ────────────────────────────────────────────────────────
// Configures the native status bar appearance on iOS and Android.
// On web/PWA this is a no-op — the browser controls the status bar.

import { StatusBar, Style } from '@capacitor/status-bar';
import { isNativePlatform, isNativeIOS } from './capacitorRuntime';

export interface StatusBarTheme {
  /** Status bar text/icon style: 'light' for dark backgrounds, 'dark' for light backgrounds. */
  style: 'light' | 'dark';
  /** Background color as hex. Only applies on Android (iOS uses translucent). */
  backgroundColor: string;
  /** Whether the WebView content renders behind the status bar. */
  overlaysWebView: boolean;
}

const DEFAULT_THEME: StatusBarTheme = {
  style: 'dark', // Dark icons on light (#F2F2F7) background.
  backgroundColor: '#F2F2F7',
  overlaysWebView: false,
};

/**
 * Configure the native status bar with the given theme.
 * Falls back to the app's default theme if none is provided.
 *
 * Safe to call on web — no-ops immediately.
 * Never throws — status bar config should never block app launch.
 */
export async function configureNativeStatusBar(
  theme: StatusBarTheme = DEFAULT_THEME,
): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    const capStyle = theme.style === 'light' ? Style.Light : Style.Dark;
    await StatusBar.setStyle({ style: capStyle });

    // setBackgroundColor only works on Android.
    if (!isNativeIOS()) {
      await StatusBar.setBackgroundColor({ color: theme.backgroundColor });
    }

    await StatusBar.setOverlaysWebView({ overlay: theme.overlaysWebView });
  } catch {
    // Status bar configuration must never block app launch.
  }
}

/**
 * Show the status bar (if it was previously hidden).
 */
export async function showStatusBar(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await StatusBar.show();
  } catch {
    // Non-critical.
  }
}

/**
 * Hide the status bar (e.g., for immersive media viewing).
 */
export async function hideStatusBar(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await StatusBar.hide();
  } catch {
    // Non-critical.
  }
}
