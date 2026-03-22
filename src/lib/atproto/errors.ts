// ─── ATProto Error Normalization ───────────────────────────────────────────
// Classifies every error that can come back from BskyAgent calls into a typed,
// actionable shape so callers never have to inspect raw error messages.

export type AtpErrorKind =
  | 'auth'          // 401 / AuthenticationRequired — session expired or invalid
  | 'forbidden'     // 403 — insufficient permissions
  | 'not_found'     // 404 — record or actor does not exist
  | 'rate_limit'    // 429 — too many requests; may include Retry-After
  | 'server'        // 500/502/503/504 — transient server-side failure
  | 'network'       // fetch failed / no connectivity
  | 'cancelled'     // AbortController signal fired
  | 'unknown';      // anything else

export interface AtpError {
  kind: AtpErrorKind;
  message: string;
  status?: number;
  retryAfterMs?: number;   // populated for rate_limit errors
  original: unknown;
}

// HTTP status codes that are safe to retry with backoff
export const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// HTTP status codes that must NEVER be retried
export const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export function normalizeError(err: unknown): AtpError {
  // AbortError — request was cancelled intentionally
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'cancelled', message: 'Request cancelled', original: err };
  }

  // Network failure (fetch threw before getting a response)
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return { kind: 'network', message: 'Network error — check your connection', original: err };
  }

  // @atproto/api wraps HTTP errors with a `status` field
  const anyErr = err as any;
  const status: number | undefined = anyErr?.status ?? anyErr?.error?.status;
  const message: string = anyErr?.message ?? anyErr?.error?.message ?? String(err);

  if (status === 401 || message.includes('AuthenticationRequired') || message.includes('ExpiredToken')) {
    return { kind: 'auth', message: 'Session expired — please sign in again', status, original: err };
  }
  if (status === 403) {
    return { kind: 'forbidden', message: 'You do not have permission to do that', status, original: err };
  }
  if (status === 404) {
    return { kind: 'not_found', message: 'Not found', status, original: err };
  }
  if (status === 429) {
    const retryAfter = anyErr?.headers?.get?.('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
    return { kind: 'rate_limit', message: 'Rate limited — please wait a moment', status, retryAfterMs, original: err };
  }
  if (status && status >= 500) {
    return { kind: 'server', message: 'Server error — please try again shortly', status, original: err };
  }

  return { kind: 'unknown', message, status, original: err };
}

export function isRetryable(err: AtpError): boolean {
  if (err.kind === 'cancelled') return false;
  if (err.kind === 'auth' || err.kind === 'forbidden' || err.kind === 'not_found') return false;
  if (err.kind === 'rate_limit' || err.kind === 'server' || err.kind === 'network') return true;
  return false;
}
