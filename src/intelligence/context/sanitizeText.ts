// ─── Deterministic Context — Text Sanitization ────────────────────────────
// All text entering scoring/writer stages passes through here first.
//
// Design constraints:
//   • Pure functions — no side effects, no I/O.
//   • Fail-closed: on any error, return empty string rather than crashing.
//   • Never log raw user text — only structural metadata.
//   • Preserve ATProto facet-significant characters: @ # URLs.
//   • Strip control characters and pathological whitespace.
//   • Normalize Unicode to NFC (composed form) for consistent tokenization.

import { MAX_REPLY_TEXT_LEN, MAX_ROOT_TEXT_LEN } from './limits';

// ─── Constants ─────────────────────────────────────────────────────────────

// Characters that should be collapsed to a single space.
// Includes zero-width spaces, non-breaking spaces, tab, form feed, etc.
const COLLAPSIBLE_WHITESPACE_RE = /[\t\f\r\u00a0\u200b\u200c\u200d\u2028\u2029\ufeff]+/g;

// Control characters that serve no text purpose (C0/C1 except newline).
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

// Runs of 3+ newlines collapsed to exactly two (one blank line).
const EXCESSIVE_NEWLINES_RE = /\n{3,}/g;

// Trailing whitespace on each line.
const TRAILING_SPACE_RE = /[ \t]+$/gm;

// ─── normalizeUnicode ─────────────────────────────────────────────────────

/**
 * Normalize Unicode to NFC (composed form).
 * Safe fallback: returns the original string if normalization throws.
 */
export function normalizeUnicode(text: string): string {
  try {
    return text.normalize('NFC');
  } catch {
    return text;
  }
}

// ─── stripControlChars ────────────────────────────────────────────────────

/**
 * Remove C0/C1 control characters except newline (\n).
 * Preserves all printable Unicode, including emoji and CJK.
 */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_RE, '');
}

// ─── collapseWhitespace ───────────────────────────────────────────────────

/**
 * Collapse collapsible whitespace characters to a single space.
 * Does NOT collapse newlines — those are handled separately.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(COLLAPSIBLE_WHITESPACE_RE, ' ');
}

// ─── normalizeNewlines ────────────────────────────────────────────────────

/**
 * Normalize excessive newlines (3+) to at most two (\n\n = one blank line).
 * Strip trailing whitespace per line.
 */
export function normalizeNewlines(text: string): string {
  return text
    .replace(TRAILING_SPACE_RE, '')
    .replace(EXCESSIVE_NEWLINES_RE, '\n\n');
}

// ─── capLength ────────────────────────────────────────────────────────────

/**
 * Hard-cap text at `maxLen` characters, truncating at the last word boundary
 * within the cap. Does not add ellipsis — callers may add if needed.
 */
export function capLength(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  // Try to break at the last space within 85% of the cap to avoid mid-word cuts.
  const boundary = slice.lastIndexOf(' ', Math.floor(maxLen * 0.85));
  return boundary > 0 ? slice.slice(0, boundary) : slice;
}

// ─── sanitizeReplyText ────────────────────────────────────────────────────

/**
 * Full sanitization pipeline for a reply/post body.
 * Applies NFC, control-char strip, whitespace collapse, newline normalization,
 * and a hard length cap.
 *
 * Returns an empty string if the input is not a string.
 */
export function sanitizeReplyText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return capLength(
      normalizeNewlines(
        collapseWhitespace(
          stripControlChars(
            normalizeUnicode(raw),
          ),
        ),
      ),
      MAX_REPLY_TEXT_LEN,
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Full sanitization pipeline for the root post body.
 * Same as sanitizeReplyText but with a larger cap.
 */
export function sanitizeRootText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return capLength(
      normalizeNewlines(
        collapseWhitespace(
          stripControlChars(
            normalizeUnicode(raw),
          ),
        ),
      ),
      MAX_ROOT_TEXT_LEN,
    ).trim();
  } catch {
    return '';
  }
}

// ─── sanitizeHandle ───────────────────────────────────────────────────────

/**
 * Sanitize an ATProto handle for safe embedding in structured output.
 * Strips leading @, lowercases, removes any character that is not alphanumeric,
 * hyphen, or period. Max 253 chars (DNS label limit).
 */
export function sanitizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return raw
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9.\-]/g, '')
      .slice(0, 253);
  } catch {
    return '';
  }
}

// ─── sanitizeDisplayName ──────────────────────────────────────────────────

/**
 * Sanitize a display name.
 * Strips control chars, collapses whitespace, caps at 64 chars.
 */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return capLength(
      collapseWhitespace(
        stripControlChars(
          normalizeUnicode(raw),
        ),
      ).trim(),
      64,
    );
  } catch {
    return '';
  }
}
