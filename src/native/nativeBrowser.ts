// ─── Native External Browser ──────────────────────────────────────────────────
// Opens external URLs safely:
//   - Capacitor native → in-app browser sheet (SFSafariViewController / Chrome Custom Tabs)
//   - Web → window.open with noopener/noreferrer
//
// Validates URL scheme before opening — blocks javascript:, data:, etc.

import { Browser } from '@capacitor/browser';
import { isNativePlatform } from './capacitorRuntime';

/** Allowed URL protocols for external link opening. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Open an external URL safely.
 *
 * On native: uses @capacitor/browser (SFSafariViewController on iOS,
 * Chrome Custom Tabs on Android) which keeps the user in the app context.
 *
 * On web: uses window.open with security attributes.
 *
 * Returns true if the URL was opened successfully, false on failure.
 * Never throws — safe to call directly from UI event handlers.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    const parsed = parseAndValidateUrl(url);

    if (isNativePlatform()) {
      await Browser.open({
        url: parsed.toString(),
        // presentationStyle is iOS-only — sheet is more native-feeling.
        presentationStyle: 'popover',
      });
      return true;
    }

    // Web fallback: open in new tab with security attributes.
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    return true;
  } catch (err: unknown) {
    console.warn('[NativeBrowser] Failed to open URL:', (err as Error)?.message ?? 'unknown');
    return false;
  }
}

/**
 * Close the in-app browser (if open). No-op on web.
 */
export async function closeExternalBrowser(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Browser.close();
  } catch {
    // Browser may not be open — swallow.
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function parseAndValidateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  return parsed;
}
