// ─── Native Share ─────────────────────────────────────────────────────────────
// Unified share interface across all runtime targets:
//   1. Capacitor native → native share sheet
//   2. Web with navigator.share → Web Share API
//   3. Fallback → copy to clipboard
//
// Never throws — returns a result indicating what happened.

import { Share } from '@capacitor/share';
import { isNativePlatform, isNativeIOS } from './capacitorRuntime';

export interface ShareInput {
  title?: string;
  text?: string;
  url: string;
}

export type ShareResult =
  | { method: 'native'; shared: boolean }
  | { method: 'web-share'; shared: boolean }
  | { method: 'clipboard'; copied: boolean }
  | { method: 'unavailable' };

/**
 * Share a URL using the best available method for the current runtime.
 *
 * Priority:
 *   1. Capacitor Share plugin (native iOS/Android share sheet)
 *   2. Web Share API (navigator.share — mobile browsers, some desktop)
 *   3. Clipboard fallback (navigator.clipboard.writeText)
 *   4. Returns 'unavailable' if none work
 */
export async function shareUrl(input: ShareInput): Promise<ShareResult> {
  // 1. Native share via Capacitor
  if (isNativePlatform()) {
    try {
      const result = await Share.share({
        title: input.title ?? '',
        text: input.text ?? '',
        url: input.url,
        dialogTitle: input.title ?? 'Share',
      });
      // activityType is set on iOS when the user completes the share.
      // On Android, the share sheet doesn't report back reliably — assume
      // success if the promise resolved without throwing.
      const shared = isNativeIOS() ? result.activityType != null : true;
      return { method: 'native', shared };
    } catch {
      // User cancelled or share failed — fall through to web share.
    }
  }

  // 2. Web Share API
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await navigator.share({
        title: input.title ?? '',
        text: input.text ?? '',
        url: input.url,
      });
      return { method: 'web-share', shared: true };
    } catch (err: unknown) {
      // AbortError means user cancelled — not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { method: 'web-share', shared: false };
      }
      // Other errors: fall through to clipboard.
    }
  }

  // 3. Clipboard fallback
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(input.url);
      return { method: 'clipboard', copied: true };
    } catch {
      return { method: 'clipboard', copied: false };
    }
  }

  return { method: 'unavailable' };
}
