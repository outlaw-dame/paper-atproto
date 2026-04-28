// ─── ATProto Blob Upload Service ─────────────────────────────────────────────
// Validates and uploads blobs to the AT Protocol PDS with:
//   • MIME-type allowlist enforcement before any network activity
//   • File-size limits per blob kind matching Bluesky's published limits
//   • Exponential backoff + decorrelated jitter via atpCall
//   • Structured, typed error codes for precise UI feedback
//   • Privacy: file content is never logged; only sanitized metadata is exposed
//
// Usage:
//   const result = await uploadBlob(agent, file, 'image', {
//     onProgress: (p) => setUploadProgress(p),
//   });
//   if (result.ok) {
//     // result.blob → BlobRef ready to embed in app.bsky.feed.post
//   } else {
//     // result.code → BlobUploadErrorCode for branch-specific UI
//   }

import { atpCall } from '../lib/atproto/client';

// ─── Public types ─────────────────────────────────────────────────────────────

/** The kind of media being uploaded, used to select the MIME allowlist and size limit. */
export type BlobKind = 'image' | 'video' | 'audio' | 'caption';

/**
 * Typed error codes so callers can branch on specific failure reasons
 * without inspecting error message strings.
 */
export type BlobUploadErrorCode =
  | 'unsupported-type'  // MIME type not in the allowlist for this BlobKind
  | 'file-too-large'    // File exceeds the size limit for this BlobKind
  | 'file-empty'        // File has zero bytes
  | 'upload-failed'     // Server rejected the upload (non-auth, non-network)
  | 'auth-required'     // Session expired; user must re-authenticate
  | 'network-error'     // Connectivity failure; safe to retry
  | 'aborted';          // Caller cancelled via AbortSignal

export interface BlobUploadFailure {
  readonly ok: false;
  readonly code: BlobUploadErrorCode;
  /** Human-readable message safe to surface in the UI. Max 200 chars. */
  readonly message: string;
  /** True when the caller may retry the upload without user intervention. */
  readonly retryable: boolean;
}

export interface BlobUploadSuccess {
  readonly ok: true;
  /**
   * The ATProto BlobRef returned by the PDS.
   * Type is `unknown` to avoid importing @atproto/api on the critical path;
   * cast to `BlobRef` at the call site once @atproto/api is available.
   */
  readonly blob: unknown;
  /** MIME type resolved and used for the upload (lowercase, no params). */
  readonly mimeType: string;
  /** Exact byte count of the uploaded file. */
  readonly byteCount: number;
}

export type BlobUploadResult = BlobUploadSuccess | BlobUploadFailure;

export interface BlobUploadOptions {
  /** External cancellation signal. */
  signal?: AbortSignal;
  /**
   * Progress callback receiving a fraction in [0, 1].
   *
   * Milestones:
   *   0.00 — upload queued
   *   0.10 — validation passed, about to transmit
   *   0.90 — request in flight (waiting for server ACK)
   *   1.00 — upload accepted by PDS
   *
   * Note: intermediate byte-level progress is not available because
   * agent.uploadBlob() owns the underlying HTTP request.  Use these
   * milestones to drive an indeterminate progress indicator.
   */
  onProgress?: (fraction: number) => void;
  /**
   * Maximum upload attempts (includes the first attempt).
   * Only transient failures (network, 5xx, rate-limit) trigger retries.
   * Default: 3.
   */
  maxAttempts?: number;
  /**
   * Per-attempt timeout in milliseconds.
   * Default: 60 000 (1 min) — generous for mobile connections with large files.
   */
  timeoutMs?: number;
}

// ─── Agent interface ──────────────────────────────────────────────────────────

/**
 * Structural interface satisfied by @atproto/api's Agent.
 * Avoids importing the heavy @atproto/api package from this module so it
 * stays off the critical rendering path.
 */
interface BlobCapableAgent {
  uploadBlob(
    data?: unknown,
    opts?: { encoding?: string; signal?: AbortSignal },
  ): Promise<{ data?: { blob?: unknown } }>;
}

// ─── MIME-type allowlists ─────────────────────────────────────────────────────
//
// Mirrors Bluesky's server-side blob type enforcement.
// Client-side validation provides immediate feedback and avoids wasted bandwidth.

const ALLOWED_IMAGE_TYPES = new Set<string>([
  'image/jpeg',
  'image/jpg',   // non-standard alias for JPEG; PDSes normalise to image/jpeg
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',  // iOS default capture format
  'image/heif',
]);

const ALLOWED_VIDEO_TYPES = new Set<string>([
  'video/mp4',
  'video/quicktime',  // .mov — common on iOS
  'video/webm',
  'video/x-matroska', // .mkv
  'video/x-msvideo',  // .avi
  'video/3gpp',
  'video/mpeg',
]);

const ALLOWED_AUDIO_TYPES = new Set<string>([
  'audio/mpeg',    // MP3
  'audio/mp3',     // non-standard alias
  'audio/ogg',
  'audio/wav',
  'audio/wave',    // alias for wav
  'audio/flac',
  'audio/x-flac',  // alias
  'audio/aac',
  'audio/mp4',     // m4a in an MP4 container
  'audio/webm',
  'audio/opus',
]);

const ALLOWED_CAPTION_TYPES = new Set<string>([
  'text/vtt',
  'text/x-vtt',    // non-standard alias
]);

const ALLOWED_TYPES: Readonly<Record<BlobKind, ReadonlySet<string>>> = {
  image: ALLOWED_IMAGE_TYPES,
  video: ALLOWED_VIDEO_TYPES,
  audio: ALLOWED_AUDIO_TYPES,
  caption: ALLOWED_CAPTION_TYPES,
};

// ─── Size limits ──────────────────────────────────────────────────────────────
//
// These match Bluesky's documented limits.
// Enforcing them locally avoids uploading data the PDS will reject.

const SIZE_LIMIT_BYTES: Readonly<Record<BlobKind, number>> = {
  image: 1_000_000,    // 1 MB — Bluesky image blob limit
  video: 100_000_000,  // 100 MB — Bluesky video upload limit
  audio: 100_000_000,  // 100 MB
  caption: 20_000,     // 20 KB — Bluesky caption track limit
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

const FILE_EXTENSION_MIME_MAP: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  vtt: 'text/vtt',
};

function inferMimeTypeFromFileName(file: File | Blob): string {
  if (!(file instanceof File)) return '';
  const name = file.name.toLowerCase();
  const extension = name.split('.').pop()?.trim() ?? '';
  if (!extension) return '';
  return FILE_EXTENSION_MIME_MAP[extension] ?? '';
}

/**
 * Resolves the effective MIME type from a File or Blob.
 * Strips parameters (e.g. "text/vtt; charset=utf-8" → "text/vtt").
 * Returns empty string if type is absent or malformed.
 */
function resolveMimeType(file: File | Blob): string {
  const raw = file.type ?? '';
  const normalized = raw.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized.length > 0) return normalized;
  return inferMimeTypeFromFileName(file);
}

type ValidationOk = { ok: true; mimeType: string; byteCount: number };
type ValidationFail = { ok: false; failure: BlobUploadFailure };
type ValidationOutcome = ValidationOk | ValidationFail;

function validateBlob(file: File | Blob, kind: BlobKind): ValidationOutcome {
  const byteCount = file.size;
  const mimeType = resolveMimeType(file);

  if (byteCount === 0) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'file-empty',
        message: 'The selected file is empty.',
        retryable: false,
      },
    };
  }

  const allowedTypes = ALLOWED_TYPES[kind];
  if (!mimeType || !allowedTypes.has(mimeType)) {
    const accepted = [...allowedTypes].join(', ');
    const label = mimeType ? `"${mimeType}"` : 'unknown type';
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'unsupported-type',
        message: `Unsupported ${kind} format (${label}). Accepted formats: ${accepted}.`,
        retryable: false,
      },
    };
  }

  const maxBytes = SIZE_LIMIT_BYTES[kind];
  if (byteCount > maxBytes) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'file-too-large',
        message: `${kind.charAt(0).toUpperCase() + kind.slice(1)} file is ${formatBytes(byteCount)}, which exceeds the ${formatBytes(maxBytes)} limit.`,
        retryable: false,
      },
    };
  }

  return { ok: true, mimeType, byteCount };
}

function mapUploadError(err: unknown): BlobUploadFailure {
  const e = err as { kind?: string; name?: string; message?: string };

  if (e.name === 'AbortError' || e.kind === 'cancelled') {
    return { ok: false, code: 'aborted', message: 'Upload was cancelled.', retryable: false };
  }
  if (e.kind === 'auth') {
    return {
      ok: false,
      code: 'auth-required',
      message: 'Your session expired. Please sign in and try again.',
      retryable: false,
    };
  }
  if (e.kind === 'network') {
    return {
      ok: false,
      code: 'network-error',
      message: 'Network error during upload. Check your connection and try again.',
      retryable: true,
    };
  }
  if (e.kind === 'rate_limit' || e.kind === 'server') {
    return {
      ok: false,
      code: 'upload-failed',
      message: 'The server is temporarily unavailable. Please try again in a moment.',
      retryable: true,
    };
  }
  return {
    ok: false,
    code: 'upload-failed',
    message: 'Upload failed. Please try again.',
    retryable: false,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Uploads a blob to the AT Protocol PDS.
 *
 * Validates the file's MIME type and byte count against the allowlist for
 * the given `kind` before making any network requests.  Uses `atpCall` for
 * automatic retry with exponential backoff and decorrelated jitter.
 *
 * The `onProgress` callback receives milestone fractions (not byte-level
 * progress) because `agent.uploadBlob` owns the underlying HTTP connection.
 *
 * @param agent   ATProto SDK agent (must have an active session).
 * @param file    The File or Blob to upload.
 * @param kind    Media category — selects the MIME allowlist and size limit.
 * @param opts    Optional overrides for progress, timeout, and retry count.
 */
export async function uploadBlob(
  agent: BlobCapableAgent,
  file: File | Blob,
  kind: BlobKind,
  opts: BlobUploadOptions = {},
): Promise<BlobUploadResult> {
  const {
    signal,
    onProgress,
    maxAttempts = 3,
    timeoutMs = 60_000,
  } = opts;

  onProgress?.(0.0); // Queued

  // ── Validate before touching the network ────────────────────────────────────
  const validation = validateBlob(file, kind);
  if (!validation.ok) {
    return validation.failure;
  }

  const { mimeType, byteCount } = validation;
  onProgress?.(0.1); // Validation passed

  try {
    const callOpts = {
      maxAttempts,
      timeoutMs,
      // exactOptionalPropertyTypes: only spread signal when defined so we
      // don't pass `signal: undefined` where `signal?: AbortSignal` is expected.
      ...(signal !== undefined ? { signal } : {}),
    };

    const response = await atpCall<{ data?: { blob?: unknown } }>(
      (callSignal) => {
        onProgress?.(0.9); // In flight
        return agent.uploadBlob(file, { encoding: mimeType, signal: callSignal });
      },
      callOpts,
    );

    const uploadedBlob = response.data?.blob;
    if (!uploadedBlob) {
      return {
        ok: false,
        code: 'upload-failed',
        message: 'Upload failed: the server did not return a blob reference.',
        retryable: true,
      };
    }

    onProgress?.(1.0); // Complete

    return {
      ok: true,
      blob: uploadedBlob,
      mimeType,
      byteCount,
    };
  } catch (err: unknown) {
    return mapUploadError(err);
  }
}

/**
 * Convenience wrapper for image uploads.
 * Equivalent to `uploadBlob(agent, file, 'image', opts)`.
 */
export function uploadImageBlob(
  agent: BlobCapableAgent,
  file: File | Blob,
  opts?: BlobUploadOptions,
): Promise<BlobUploadResult> {
  return uploadBlob(agent, file, 'image', opts);
}

/**
 * Convenience wrapper for video uploads.
 * Equivalent to `uploadBlob(agent, file, 'video', opts)`.
 */
export function uploadVideoBlob(
  agent: BlobCapableAgent,
  file: File | Blob,
  opts?: BlobUploadOptions,
): Promise<BlobUploadResult> {
  return uploadBlob(agent, file, 'video', opts);
}
