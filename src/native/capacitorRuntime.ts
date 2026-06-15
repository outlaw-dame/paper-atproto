// ─── Capacitor Runtime Detection ──────────────────────────────────────────────
// Detects whether the app is running inside a Capacitor native shell.
// Safe to call on web — returns web platform when Capacitor is not present.
//
// This module is the single source of truth for "are we in a native package?"
// All other native bridge modules should import from here rather than
// calling Capacitor.isNativePlatform() directly.

import { Capacitor } from '@capacitor/core';

export type CapacitorPlatform = 'ios' | 'android' | 'web';

export interface NativeRuntime {
  /** True when running inside a Capacitor native shell (iOS or Android). */
  readonly isNative: boolean;
  /** The current platform: 'ios', 'android', or 'web'. */
  readonly platform: CapacitorPlatform;
}

/**
 * Returns the current native runtime state.
 *
 * Safe to call at any point — never throws. When Capacitor is not present
 * (browser/PWA), returns { isNative: false, platform: 'web' }.
 */
export function getNativeRuntime(): NativeRuntime {
  try {
    const raw = Capacitor.getPlatform();
    const platform: CapacitorPlatform =
      raw === 'ios' || raw === 'android' ? raw : 'web';
    return {
      isNative: Capacitor.isNativePlatform(),
      platform,
    };
  } catch {
    // Capacitor global not available — pure web environment.
    return { isNative: false, platform: 'web' };
  }
}

/**
 * Returns true only when running inside a native iOS or Android shell.
 * Convenience shorthand for getNativeRuntime().isNative.
 */
export function isNativePlatform(): boolean {
  return getNativeRuntime().isNative;
}

/**
 * Returns true only when running inside the Capacitor iOS shell.
 */
export function isNativeIOS(): boolean {
  const rt = getNativeRuntime();
  return rt.isNative && rt.platform === 'ios';
}

/**
 * Returns true only when running inside the Capacitor Android shell.
 */
export function isNativeAndroid(): boolean {
  const rt = getNativeRuntime();
  return rt.isNative && rt.platform === 'android';
}
