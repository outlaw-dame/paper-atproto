// ─── Writer — Output Validator ────────────────────────────────────────────
// Validates writer model outputs against the contract before they reach the UI.
//
// Catches:
//   • Missing required fields
//   • Exceeded length caps
//   • Prohibited output patterns (regurgitation, advice-giving, fake consensus)
//   • Unverified contributor/entity names not present in the writer input
//   • Malformed mode fields
//
// Design constraints:
//   • Pure function — no I/O.
//   • Returns a typed ValidationResult, never throws.
//   • On validation failure, callers should use the deterministic fallback.

import type { InterpolatorWriteResult, SummaryMode, ThreadStateForWriter } from '../llmContracts';
import { STYLE, PROHIBITED_OUTPUT_PATTERNS, REGURGITATION_PATTERNS } from './styleGuide';
import { clamp01 } from '../context/limits';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  /** Specific failure reasons (for diagnostics, not shown to user). */
  failures: string[];
  /** Sanitized output (may differ from input if fields were truncated/cleaned). */
  sanitized: InterpolatorWriteResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const VALID_MODES = new Set<SummaryMode>(['normal', 'descriptive_fallback', 'minimal_fallback']);

function truncate(text: string, maxLen: number): string {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace >= Math.floor(maxLen * 0.70)
    ? `${slice.slice(0, lastSpace)}…`
    : `${slice}…`;
}

function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

function normalizedTokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 4));
  const tokB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 4));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokA) {
    if (tokB.has(t)) overlap += 1;
  }
  return clamp01(overlap / tokA.size);
}

// ─── validateWriterOutput ─────────────────────────────────────────────────

/**
 * Validate and sanitize a writer model output.
 *
 * @param result — the raw model output
 * @param input  — the ThreadStateForWriter that was sent to the model
 *
 * Returns a ValidationResult with:
 *   valid: true  → sanitized output is safe to use
 *   valid: false → use deterministic fallback instead
 *
 * Never throws.
 */
export function validateWriterOutput(
  result: InterpolatorWriteResult,
  input: ThreadStateForWriter,
): ValidationResult {
  const failures: string[] = [];

  try {
    // ── 1. Required fields ─────────────────────────────────────────────────

    const collapsedSummary = sanitizeText(result?.collapsedSummary ?? '');
    if (!collapsedSummary) {
      failures.push('missing-collapsed-summary');
    }

    const mode = result?.mode;
    if (!VALID_MODES.has(mode)) {
      failures.push(`invalid-mode:${mode}`);
    }

    // ── 2. Length caps ─────────────────────────────────────────────────────

    const sanitizedCollapsed = truncate(collapsedSummary, STYLE.COLLAPSED_SUMMARY_MAX_LEN);
    const sanitizedExpanded = result.expandedSummary
      ? truncate(sanitizeText(result.expandedSummary), STYLE.EXPANDED_SUMMARY_MAX_LEN)
      : undefined;

    // ── 3. Prohibited patterns ─────────────────────────────────────────────

    if (matchesAnyPattern(collapsedSummary, PROHIBITED_OUTPUT_PATTERNS)) {
      failures.push('prohibited-pattern-in-summary');
    }

    if (matchesAnyPattern(collapsedSummary, REGURGITATION_PATTERNS)) {
      failures.push('regurgitation-detected');
    }

    // ── 4. Root-post verbatim copy detection ──────────────────────────────

    const rootText = input.rootPost?.text ?? '';
    if (rootText.length >= 60 && normalizedTokenOverlap(sanitizedCollapsed, rootText) >= 0.75) {
      failures.push('root-post-verbatim-copy');
    }

    // ── 5. Validate contributor blurbs ────────────────────────────────────

    const allowedHandles = new Set([
      ...(input.topContributors ?? []).map(c => c.handle.toLowerCase()),
      ...(input.selectedComments ?? []).map(c => c.handle.toLowerCase()),
    ]);

    const sanitizedBlurbs = (result.contributorBlurbs ?? [])
      .filter(b => typeof b?.handle === 'string' && typeof b?.blurb === 'string')
      .filter(b => allowedHandles.has(b.handle.toLowerCase()))
      .slice(0, STYLE.MAX_BLURBS)
      .map(b => ({
        handle: sanitizeText(b.handle).slice(0, 60),
        blurb: truncate(sanitizeText(b.blurb), STYLE.BLURB_MAX_LEN),
      }))
      .filter(b => b.blurb.length >= 10);

    // ── 6. Validate whatChanged signals ───────────────────────────────────

    const sanitizedWhatChanged = (result.whatChanged ?? [])
      .filter((s): s is string => typeof s === 'string')
      .map(s => truncate(sanitizeText(s), STYLE.WHAT_CHANGED_ITEM_MAX_LEN))
      .filter(s => s.length >= 5)
      .slice(0, STYLE.MAX_WHAT_CHANGED);

    // ── 7. Abstention handling ────────────────────────────────────────────

    const abstained = result.abstained === true;
    if (abstained && collapsedSummary.length > 0) {
      // Model said "abstained" but also returned content — trust the abstention.
      failures.push('abstained-with-content');
    }

    const sanitized: InterpolatorWriteResult = {
      collapsedSummary: sanitizedCollapsed,
      ...(sanitizedExpanded ? { expandedSummary: sanitizedExpanded } : {}),
      whatChanged: sanitizedWhatChanged,
      contributorBlurbs: sanitizedBlurbs,
      abstained,
      mode: VALID_MODES.has(mode) ? mode : input.summaryMode,
    };

    return {
      valid: failures.length === 0,
      failures,
      sanitized,
    };
  } catch {
    return {
      valid: false,
      failures: ['validation-error'],
      sanitized: {
        collapsedSummary: '',
        whatChanged: [],
        contributorBlurbs: [],
        abstained: true,
        mode: input?.summaryMode ?? 'minimal_fallback',
      },
    };
  }
}
