// ─── Protocol Handler ───────────────────────────────────────────────────────
// Processes incoming protocol handler launches landing on /open?uri=...
// according to manifest protocol_handlers entries.
//
// Security:
// - Sanitises incoming URI values (strip controls, bound length).
// - Accepts only known ATProto patterns (did, handle, at:// post URI).
// - Never evals or navigates directly from untrusted URI input.
//
// Reliability:
// - Caches the latest payload until consumed by a mounted UI bridge.
// - Emits retries with bounded backoff to reduce startup race conditions.

export type ProtocolPayloadType = 'profile' | 'post' | 'handle' | 'unknown';

export interface ProtocolPayload {
  rawUri: string;
  canonicalUri: string;
  type: ProtocolPayloadType;
  parsed: {
    did?: string;
    handle?: string;
    atUri?: string;
  };
}

const OPEN_PATH_SUFFIXES = ['/open', '/open/'];
const PROTOCOL_DISPATCH_EVENT = 'paper:protocol-handler';
const MAX_URI_LENGTH = 2048;
const PROTOCOL_RETRY_DELAYS_MS = [75, 200, 500] as const;

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const DID_PATTERN = /^did:[a-z0-9]+:[a-z0-9.:%_-]+$/i;
const AT_POST_URI_PATTERN = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/i;

let pendingProtocolPayload: ProtocolPayload | null = null;

function sanitizeBoundedString(value: string | null, maxLength: number): string {
  if (!value) return '';
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function decodeUriParam(encodedUri: string): string {
  let decoded = encodedUri;
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function isProtocolOpenPath(pathname: string): boolean {
  return OPEN_PATH_SUFFIXES.some(
    (suffix) => pathname === suffix || pathname.endsWith(suffix),
  );
}

function queueProtocolDispatch(payload: ProtocolPayload): void {
  pendingProtocolPayload = payload;

  const dispatch = () => {
    window.dispatchEvent(
      new CustomEvent<ProtocolPayload>(PROTOCOL_DISPATCH_EVENT, { detail: payload }),
    );
  };

  // Dispatch immediately and retry with bounded backoff so listeners that mount
  // after bootstrap still receive the payload at least once.
  dispatch();
  for (const delayMs of PROTOCOL_RETRY_DELAYS_MS) {
    setTimeout(dispatch, delayMs);
  }
}

function parseProtocolPayload(uriInput: string): ProtocolPayload {
  const rawUri = sanitizeBoundedString(uriInput, MAX_URI_LENGTH);
  if (!rawUri) {
    return {
      rawUri: '',
      canonicalUri: '',
      type: 'unknown',
      parsed: {},
    };
  }

  const withoutPrefix = rawUri.replace(/^web\+at:\/\//i, '');
  const canonicalUri = sanitizeBoundedString(withoutPrefix, MAX_URI_LENGTH);
  if (!canonicalUri) {
    return {
      rawUri,
      canonicalUri: '',
      type: 'unknown',
      parsed: {},
    };
  }

  if (DID_PATTERN.test(canonicalUri)) {
    return {
      rawUri,
      canonicalUri,
      type: 'profile',
      parsed: { did: canonicalUri },
    };
  }

  const atMatch = canonicalUri.match(AT_POST_URI_PATTERN);
  if (atMatch) {
    return {
      rawUri,
      canonicalUri,
      type: 'post',
      parsed: { atUri: canonicalUri },
    };
  }

  if (HANDLE_PATTERN.test(canonicalUri)) {
    return {
      rawUri,
      canonicalUri,
      type: 'handle',
      parsed: { handle: canonicalUri.toLowerCase() },
    };
  }

  return {
    rawUri,
    canonicalUri,
    type: 'unknown',
    parsed: {},
  };
}

/**
 * Returns the latest unconsumed protocol payload (if any) and clears it.
 */
export function consumePendingProtocolPayload(): ProtocolPayload | null {
  const payload = pendingProtocolPayload;
  pendingProtocolPayload = null;
  return payload;
}

/**
 * Reads URL query params for an incoming protocol launch and dispatches
 * 'paper:protocol-handler' if a URI is present.
 */
export function handleProtocolHandlerIfPresent(): ProtocolPayload | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null;
  if (!isProtocolOpenPath(location.pathname)) return null;

  try {
    const params = new URLSearchParams(location.search);
    const rawParam = sanitizeBoundedString(params.get('uri'), MAX_URI_LENGTH);
    if (!rawParam) return null;

    const decoded = decodeUriParam(rawParam);
    const payload = parseProtocolPayload(decoded);

    const cleanUrl = location.href
      .replace(location.search, '')
      .replace(/\/open\/?$/, '/');
    history.replaceState(null, '', cleanUrl);

    queueProtocolDispatch(payload);
    return payload;
  } catch (error) {
    console.warn('[protocolHandler] Failed to process protocol handler URI:', error);
    return null;
  }
}

export const __internalProtocolHandler = {
  parseProtocolPayload,
};
