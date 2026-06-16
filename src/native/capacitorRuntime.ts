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

// Cache the runtime result — platform/native status never changes during
// the app lifecycle. Avoids redundant calls to Capacitor.getPlatform() and
// Capacitor.isNativePlatform() from every bridge module.
let cachedRuntime: NativeRuntime | null = null;

/**
 * Returns the current native runtime state.
 *
 * Safe to call at any point — never throws. When Capacitor is not present
 * (browser/PWA), returns { isNative: false, platform: 'web' }.
 *
 * Result is cached after first call — the platform cannot change at runtime.
 */
export function getNativeRuntime(): NativeRuntime {
  if (cachedRuntime) return cachedRuntime;
  try {
    const raw = Capacitor.getPlatform();
    const platform: CapacitorPlatform =
      raw === 'ios' || raw === 'android' ? raw : 'web';
    cachedRuntime = Object.freeze({
      isNative: Capacitor.isNativePlatform(),
      platform,
    });
    return cachedRuntime;
  } catch {
    // Capacitor global not available — pure web environment.
    cachedRuntime = Object.freeze({ isNative: false, platform: 'web' as const });
    return cachedRuntime;
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
