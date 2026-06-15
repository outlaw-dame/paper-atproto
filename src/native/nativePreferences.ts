// ─── Native Preferences ───────────────────────────────────────────────────────
// Key-value storage for small, non-sensitive settings using @capacitor/preferences
// on native and localStorage on web.
//
// SECURITY: Do NOT store auth tokens, session secrets, push tokens, or any
// sensitive material through this interface. Capacitor Preferences uses
// UserDefaults (iOS) and SharedPreferences (Android) — both are unencrypted
// on-device storage.

import { Preferences } from '@capacitor/preferences';
import { isNativePlatform } from './capacitorRuntime';

const STORAGE_PREFIX = 'glympse.pref.';

/**
 * Set a preference value.
 * Stores as a string. Serialize complex values to JSON before calling.
 */
export async function setPreference(key: string, value: string): Promise<void> {
  const prefixedKey = STORAGE_PREFIX + key;

  if (isNativePlatform()) {
    await Preferences.set({ key: prefixedKey, value });
    return;
  }

  // Web fallback: localStorage.
  try {
    localStorage.setItem(prefixedKey, value);
  } catch {
    // Storage full or unavailable — swallow.
  }
}

/**
 * Get a preference value. Returns null if not found.
 */
export async function getPreference(key: string): Promise<string | null> {
  const prefixedKey = STORAGE_PREFIX + key;

  if (isNativePlatform()) {
    const result = await Preferences.get({ key: prefixedKey });
    return result.value;
  }

  // Web fallback: localStorage.
  try {
    return localStorage.getItem(prefixedKey);
  } catch {
    return null;
  }
}

/**
 * Remove a preference value.
 */
export async function removePreference(key: string): Promise<void> {
  const prefixedKey = STORAGE_PREFIX + key;

  if (isNativePlatform()) {
    await Preferences.remove({ key: prefixedKey });
    return;
  }

  try {
    localStorage.removeItem(prefixedKey);
  } catch {
    // Non-critical.
  }
}

/**
 * Clear all preferences under the app's prefix.
 * Use with caution — this removes all stored preferences with STORAGE_PREFIX.
 *
 * Only removes keys under our prefix — does not affect other plugins or
 * system preferences stored in the same native storage backend.
 */
export async function clearAllPreferences(): Promise<void> {
  if (isNativePlatform()) {
    try {
      const { keys } = await Preferences.keys();
      for (const key of keys) {
        if (key.startsWith(STORAGE_PREFIX)) {
          await Preferences.remove({ key });
        }
      }
    } catch {
      // Non-critical.
    }
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Non-critical.
  }
}
