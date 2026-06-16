// ─── Platform Share ───────────────────────────────────────────────────────────
// Unified share interface for all runtime targets.
//
// Priority:
//   1. Capacitor Share plugin (native iOS/Android share sheet)
//   2. Web Share API (navigator.share — mobile browsers, some desktop)
//   3. Clipboard fallback (copy URL + signal caller for toast)
//
// Use for: share post, share profile, share feed, share story/gist,
// share starter pack/list.
//
// This module re-exports the native implementation which already handles
// all three tiers of fallback. Platform-level code should import from here
// rather than directly from src/native/.

export { shareUrl } from '../native/nativeShare';
export type { ShareInput, ShareResult } from '../native/nativeShare';
