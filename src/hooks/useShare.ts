// ─── useShare Hook ────────────────────────────────────────────────────────────
// Unified share hook for React components.
//
// Uses the platform share layer (Capacitor → Web Share → clipboard fallback).
// Returns a stable callback and a status indicator for toast/feedback.
//
// Usage:
//   const { share, lastResult } = useShare();
//   <button onClick={() => share({ url: postUrl, title: 'Check this out' })}>Share</button>

import { useCallback, useState } from 'react';
import { shareUrl } from '../platform/share';
import type { ShareInput, ShareResult } from '../platform/share';
import { hapticSuccess, hapticLight } from '../platform/haptics';

export type { ShareInput, ShareResult };

export interface UseShareReturn {
  /** Trigger a share action. Returns the result. */
  share: (input: ShareInput) => Promise<ShareResult>;
  /** The result of the last share attempt (for toast display). Null if never shared. */
  lastResult: ShareResult | null;
  /** Whether a share is currently in progress. */
  sharing: boolean;
}

/**
 * React hook providing a platform-aware share function with haptic feedback.
 *
 * Priority:
 *   1. Capacitor Share plugin (native sheet on iOS/Android)
 *   2. Web Share API (navigator.share)
 *   3. Clipboard fallback (copies URL)
 *
 * Provides haptic feedback on success (light tap) and exposes
 * lastResult for the caller to show a toast (e.g. "Link copied").
 */
export function useShare(): UseShareReturn {
  const [lastResult, setLastResult] = useState<ShareResult | null>(null);
  const [sharing, setSharing] = useState(false);

  const share = useCallback(async (input: ShareInput): Promise<ShareResult> => {
    setSharing(true);
    try {
      const result = await shareUrl(input);
      setLastResult(result);

      // Haptic feedback based on outcome
      if (
        (result.method === 'native' && result.shared) ||
        (result.method === 'web-share' && result.shared) ||
        (result.method === 'clipboard' && result.copied)
      ) {
        hapticSuccess();
      } else if (result.method !== 'unavailable') {
        hapticLight();
      }

      return result;
    } finally {
      setSharing(false);
    }
  }, []);

  return { share, lastResult, sharing };
}
