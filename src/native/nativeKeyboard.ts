// ─── Native Keyboard Bridge ───────────────────────────────────────────────────
// Tracks native keyboard show/hide events and exposes the keyboard height
// as a CSS custom property (--native-keyboard-height) for layout adjustments.
//
// On native iOS/Android, the Capacitor Keyboard plugin fires events before
// the keyboard animates in/out. This lets CSS/layout respond to the keyboard
// without relying on viewport resize heuristics.
//
// On web, this module is a no-op — browser viewport handling remains unchanged.

import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import { isNativePlatform, isNativeIOS } from './capacitorRuntime';

let initialized = false;

/** Current keyboard height in pixels. 0 when hidden. */
let currentKeyboardHeight = 0;

/**
 * Returns the current native keyboard height in pixels.
 * Returns 0 on web or when the keyboard is hidden.
 */
export function getKeyboardHeight(): number {
  return currentKeyboardHeight;
}

/**
 * Initialize the native keyboard bridge.
 *
 * Sets --native-keyboard-height CSS custom property on <html> when the
 * keyboard shows/hides. Components can use this variable for bottom padding,
 * composer positioning, etc.
 *
 * Safe to call multiple times — only initializes once.
 * No-op on web.
 */
export async function initNativeKeyboardBridge(): Promise<void> {
  if (initialized || !isNativePlatform()) return;
  initialized = true;

  // iOS supports keyboardWillShow/Hide (fires before animation).
  // Android only supports keyboardDidShow/Hide (fires after animation).
  if (isNativeIOS()) {
    await Keyboard.addListener('keyboardWillShow', (info: KeyboardInfo) => {
      currentKeyboardHeight = info.keyboardHeight;
      setKeyboardCssVars(info.keyboardHeight);
    });

    await Keyboard.addListener('keyboardWillHide', () => {
      currentKeyboardHeight = 0;
      setKeyboardCssVars(0);
    });
  } else {
    await Keyboard.addListener('keyboardDidShow', (info: KeyboardInfo) => {
      currentKeyboardHeight = info.keyboardHeight;
      setKeyboardCssVars(info.keyboardHeight);
    });

    await Keyboard.addListener('keyboardDidHide', () => {
      currentKeyboardHeight = 0;
      setKeyboardCssVars(0);
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setKeyboardCssVars(heightPx: number): void {
  try {
    const el = document.documentElement;
    el.style.setProperty(
      '--native-keyboard-height',
      `${Math.max(0, Math.round(heightPx))}px`,
    );
    el.style.setProperty(
      '--keyboard-visible',
      heightPx > 0 ? '1' : '0',
    );
  } catch {
    // DOM manipulation should never crash the app.
  }
}
