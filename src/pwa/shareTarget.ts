// ─── Web Share Target Handler ──────────────────────────────────────────────────
// Processes incoming OS share requests that land on /share-target?title=&text=&url=
// per the Web Share Target API (manifest.json share_target.action).
//
// The handler normalises the shared payload and dispatches a CustomEvent that
// the ComposeSheet listens to for pre-filling the text field. It then removes
// the query params from the URL so Back/refresh doesn't re-trigger the flow.
//
// Security: all values are string-sanitised; no HTML parsing, no eval.
// Privacy:  shared content is never logged or sent anywhere by this module.
//
// Called once from bootstrap.ts, before React renders.

export interface SharedPayload {
  title: string;
  text: string;
  url: string;
}

const SHARE_PATH_SUFFIXES = ['/share-target', '/share-target/'];

function sanitizeSharedString(value: string | null, maxLen = 2000): string {
  if (!value) return '';
  // Strip C0/C1 control characters except ordinary whitespace.
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isShareTargetPath(pathname: string): boolean {
  return SHARE_PATH_SUFFIXES.some(
    (suffix) => pathname === suffix || pathname.endsWith(suffix),
  );
}

/**
 * Reads URL query params for an incoming OS share and, if present, dispatches
 * 'paper:share-target' on window and clears the params from the URL.
 *
 * Returns the parsed payload, or null if this is not a share-target request.
 */
export function handleShareTargetIfPresent(): SharedPayload | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null;

  if (!isShareTargetPath(location.pathname)) return null;

  try {
    const params = new URLSearchParams(location.search);
    const payload: SharedPayload = {
      title: sanitizeSharedString(params.get('title')),
      text:  sanitizeSharedString(params.get('text')),
      url:   sanitizeSharedString(params.get('url')),
    };

    // Nothing was shared — could be a direct navigation to /share-target.
    if (!payload.title && !payload.text && !payload.url) return null;

    // Remove share params from history to prevent re-processing on Back/reload.
    // Navigate to the app root while preserving the history entry.
    const cleanUrl = location.href
      .replace(location.search, '')
      .replace(/\/share-target\/?$/, '/');
    history.replaceState(null, '', cleanUrl);

    // Defer the event slightly so the React tree has time to mount and subscribe.
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent<SharedPayload>('paper:share-target', { detail: payload }),
      );
    }, 300);

    return payload;
  } catch (err) {
    // Non-fatal: a malformed share URL should not break app startup.
    console.warn('[shareTarget] Failed to process share-target params:', err);
    return null;
  }
}
