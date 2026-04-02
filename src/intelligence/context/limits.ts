// ─── Deterministic Context — Length / Count Limits ────────────────────────
// Single source of truth for all text-length caps, item caps, and score
// clamping ranges used throughout the context substrate layer.
//
// Design constraints:
//   • All values are conservative upper bounds — anything that can go wrong
//     at scale (pathological input, adversarial content) should be caught here
//     before it reaches scoring or model layers.
//   • Never throw: callers should slice or clamp, not crash.

// ─── Text lengths ──────────────────────────────────────────────────────────

/** Maximum characters kept for a single reply/post body. */
export const MAX_REPLY_TEXT_LEN = 1_000;

/** Maximum characters kept for the root post body sent to context builders. */
export const MAX_ROOT_TEXT_LEN = 2_000;

/** Maximum characters for a deterministic context summary sentence. */
export const MAX_CONTEXT_SUMMARY_LEN = 300;

/** Maximum characters for a direct-parent condensed summary. */
export const MAX_PARENT_SUMMARY_LEN = 180;

/** Maximum characters for a reply-context summary block. */
export const MAX_REPLY_CONTEXT_LEN = 220;

/** Maximum characters for an extracted evidence excerpt. */
export const MAX_EVIDENCE_EXCERPT_LEN = 160;

/** Maximum characters for a canonical source label (e.g. "Reuters reporting"). */
export const MAX_SOURCE_LABEL_LEN = 80;

/** Maximum characters for a source URL, after tracking-param stripping. */
export const MAX_SOURCE_URL_LEN = 512;

// ─── Item counts ───────────────────────────────────────────────────────────

/** Maximum evidence signals extracted per post. */
export const MAX_EVIDENCE_PER_POST = 6;

/** Maximum URLs extracted from a single text string. */
export const MAX_URLS_PER_TEXT = 8;

/** Maximum quoted spans retained per post. */
export const MAX_QUOTED_SPANS = 4;

/** Maximum numeric data-point excerpts retained per post. */
export const MAX_DATA_POINTS = 4;

/** Maximum replies kept in the canonical visible branch. */
export const MAX_VISIBLE_BRANCH_SIZE = 40;

/** Maximum sibling replies included in the reply-context window. */
export const MAX_SIBLING_CONTEXT = 5;

/** Maximum ancestor posts walked when building the thread graph. */
export const MAX_ANCESTOR_DEPTH = 10;

// ─── Score clamping ────────────────────────────────────────────────────────

/** All scores produced by this layer must stay within [0, 1]. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Clamp to a non-negative integer. */
export function clampCount(v: number): number {
  return Math.max(0, Math.floor(Number.isFinite(v) ? v : 0));
}
