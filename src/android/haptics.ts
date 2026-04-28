// ─── Android Haptic Feedback ──────────────────────────────────────────────────
// Typed wrapper around the Vibration API (navigator.vibrate).
// Patterns are aligned with Material Design 3 haptic guidelines.
//
// Platform behaviour:
//   - Android Chrome 32+: patterns are honored.
//   - iOS Safari: navigator.vibrate is absent — all calls are silent no-ops.
//   - Desktop Chrome: navigator.vibrate is present but produces no sensation;
//     calls succeed silently (safe to call cross-platform).
//   - Some Samsung/Xiaomi WebView builds: vibrate() may throw — caught internally.
//
// Usage:
//   import { haptic } from '../android/haptics';
//   haptic('light');   // tap feedback
//   haptic('success'); // action confirmed

// ─── Haptic patterns ──────────────────────────────────────────────────────────
// Each value is a Vibration API argument:
//   number       → single vibration of that duration in ms
//   number[]     → alternating [vibrate, pause, vibrate, ...] in ms
//
// Tuned for Android's typical LRA (linear resonant actuator) latency of ~10ms.

const HAPTIC_PATTERNS = {
  /** Minimal tap — selection changed, item tapped (Material: Selection). */
  light: 10,
  /** Moderate tap — toggle confirmed, segmented control changed (Material: Light impact). */
  medium: 20,
  /** Strong impact — destructive action, force-press (Material: Heavy impact). */
  heavy: 50,
  /** Quick double-tap — radio/checkbox change, picker scroll step. */
  selection: [8, 40, 8] as number[],
  /** Two-beat success riff — post sent, follow confirmed. */
  success: [12, 80, 20] as number[],
  /** Double error pulse — network error, validation failure. */
  error: [60, 40, 60] as number[],
  /** Single warning tap — caution state, quota nearly reached. */
  warning: 40,
} as const;

export type HapticStyle = keyof typeof HAPTIC_PATTERNS;

// ─── Guards ───────────────────────────────────────────────────────────────────

function isVibrationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire a typed haptic pattern.
 *
 * Never throws. Silently no-ops if:
 *   - The Vibration API is absent (iOS, Firefox desktop).
 *   - The document is hidden or the page hasn't had a user interaction yet.
 *   - A permission or security constraint prevents vibration.
 */
export function haptic(style: HapticStyle): void {
  if (!isVibrationAvailable()) return;
  try {
    navigator.vibrate(HAPTIC_PATTERNS[style]);
  } catch {
    // Some OEM WebView builds throw on vibrate() — silently ignored.
  }
}

/**
 * Cancel any in-progress vibration pattern immediately.
 * Safe to call unconditionally — no-ops if the API is absent.
 */
export function cancelHaptic(): void {
  if (!isVibrationAvailable()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // Ignored.
  }
}
