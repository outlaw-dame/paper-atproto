// ─── Platform External URL ────────────────────────────────────────────────────
// Opens external URLs safely across all runtime targets.
//
// Priority:
//   1. Capacitor Browser plugin in native apps (SFSafariViewController / CCT)
//   2. window.open with noopener/noreferrer on web
//
// Rules:
//   - Only allows http/https protocols.
//   - Rejects javascript:, file:, data:, blob: unconditionally.
//   - Preserves existing external-link guard behavior.
//   - Never opens untrusted schemes directly.
//
// Platform-level code should import from here rather than directly from
// src/native/nativeBrowser.ts.

export { openExternalUrl, closeExternalBrowser } from '../native/nativeBrowser';
