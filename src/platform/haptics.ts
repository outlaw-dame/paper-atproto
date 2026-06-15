// ─── Platform Haptics ─────────────────────────────────────────────────────────
// Unified haptics interface for all runtime targets.
//
// Priority:
//   1. Capacitor native haptics (iOS Taptic Engine / Android vibration motor)
//   2. Browser Vibration API on Android Chrome
//   3. Safe no-op (never breaks UI)
//
// Recommended usage:
//   - tab switch: hapticSelection()
//   - successful post: hapticSuccess()
//   - failed post: hapticError()
//   - long press: hapticMedium()
//   - save/bookmark: hapticLight()
//   - like: hapticLight()
//   - pull-to-refresh threshold: hapticMedium()
//   - sheet open/close: hapticSelection() (subtle)
//
// Do NOT overuse haptics — they should feel deliberate and meaningful.

export {
  nativeHaptic,
  hapticSelection,
  hapticLight,
  hapticSuccess,
} from '../native/nativeHaptics';

export type { NativeHapticKind } from '../native/nativeHaptics';

// ─── Additional convenience exports for common interactions ───────────────────

import { nativeHaptic } from '../native/nativeHaptics';

/** Medium impact — pull-to-refresh threshold, long press activation. */
export function hapticMedium(): void {
  void nativeHaptic('medium');
}

/** Error notification — failed post, validation error. */
export function hapticError(): void {
  void nativeHaptic('error');
}

/** Warning notification — destructive action confirmation. */
export function hapticWarning(): void {
  void nativeHaptic('warning');
}

/** Heavy impact — force touch, significant state change. */
export function hapticHeavy(): void {
  void nativeHaptic('heavy');
}
