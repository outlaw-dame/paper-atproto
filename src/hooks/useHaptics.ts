// ─── useHaptics ───────────────────────────────────────────────────────────────
// Platform-aware haptic feedback hook. Respects the resolved hapticsSupport
// level from usePlatformUX so callers don't need to guard themselves.
//
// Usage:
//   const { trigger } = useHaptics();
//   trigger('light');   // tap feedback
//   trigger('success'); // action confirmed
//
// Reduction rules:
//   hapticsSupport === 'none'  → all calls are no-ops
//   hapticsSupport === 'light' → 'heavy' patterns are downgraded to 'medium'
//   hapticsSupport === 'full'  → patterns pass through unchanged

import { useCallback } from 'react';
import { usePlatformUX } from './usePlatformUX';
import { haptic, type HapticStyle } from '../android/haptics';

/**
 * Resolve the effective haptic style given the platform support level.
 * Prevents over-vibrating on platforms with light actuators.
 */
function resolveStyle(style: HapticStyle, support: 'full' | 'light' | 'none'): HapticStyle | null {
  if (support === 'none') return null;
  if (support === 'light' && style === 'heavy') return 'medium';
  return style;
}

export interface UseHapticsReturn {
  /** Fire a haptic pattern. No-ops when the platform has no haptics support. */
  readonly trigger: (style: HapticStyle) => void;
  /** Whether haptics are available on this platform. */
  readonly available: boolean;
}

export function useHaptics(): UseHapticsReturn {
  const ux = usePlatformUX();
  const support = ux.hapticsSupport;

  const trigger = useCallback(
    (style: HapticStyle) => {
      const resolved = resolveStyle(style, support);
      if (resolved !== null) {
        haptic(resolved);
      }
    },
    [support],
  );

  return { trigger, available: support !== 'none' };
}
