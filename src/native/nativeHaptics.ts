// ─── Native Haptic Feedback ───────────────────────────────────────────────────
// Provides haptic feedback using Capacitor's Haptics plugin on native,
// with a graceful no-op on web. Never breaks the UI — all errors are swallowed.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativePlatform } from './capacitorRuntime';

export type NativeHapticKind =
  | 'selection'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

/**
 * Trigger a haptic feedback event.
 *
 * On native (iOS/Android): uses the Capacitor Haptics plugin.
 * On web: attempts navigator.vibrate() as a weak fallback for Android Chrome,
 * otherwise no-ops silently.
 *
 * Never throws. Haptics are a UX enhancement, never a blocker.
 */
export async function nativeHaptic(kind: NativeHapticKind): Promise<void> {
  if (isNativePlatform()) {
    try {
      switch (kind) {
        case 'selection':
          await Haptics.selectionChanged();
          return;
        case 'light':
          await Haptics.impact({ style: ImpactStyle.Light });
          return;
        case 'medium':
          await Haptics.impact({ style: ImpactStyle.Medium });
          return;
        case 'heavy':
          await Haptics.impact({ style: ImpactStyle.Heavy });
          return;
        case 'success':
          await Haptics.notification({ type: NotificationType.Success });
          return;
        case 'warning':
          await Haptics.notification({ type: NotificationType.Warning });
          return;
        case 'error':
          await Haptics.notification({ type: NotificationType.Error });
          return;
      }
    } catch {
      // Haptics must never break the UI.
    }
    return;
  }

  // Web fallback: short vibration on Android Chrome (non-blocking).
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      const durationMs = kind === 'selection' ? 5 : kind === 'light' ? 10 : 20;
      navigator.vibrate(durationMs);
    }
  } catch {
    // vibrate() is best-effort.
  }
}

/**
 * Convenience: selection-tap haptic for list item taps, tab switches, etc.
 */
export function hapticSelection(): void {
  void nativeHaptic('selection');
}

/**
 * Convenience: light impact for button presses.
 */
export function hapticLight(): void {
  void nativeHaptic('light');
}

/**
 * Convenience: success notification for completed actions.
 */
export function hapticSuccess(): void {
  void nativeHaptic('success');
}
