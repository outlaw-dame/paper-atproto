// ─── Writer — Prompt Builder ──────────────────────────────────────────────
// Assembles the final prompt sent to the writer model.
// Selects the appropriate template, sanitizes all user-derived content
// before interpolation, and applies mode-specific constraints.
//
// Design constraints:
//   • Pure function — no I/O, no model calls.
//   • All user text is pre-sanitized via sanitizeText helpers.
//   • Never inject raw model output into a new prompt.
//   • Prompt max length is capped to prevent token overflow.

import type { ThreadStateForWriter, SummaryMode } from '../llmContracts';
import {
  buildNormalSummaryPrompt,
  buildDescriptiveFallbackPrompt,
  buildMinimalFallbackPrompt,
} from './promptTemplates';

// ─── Constants ────────────────────────────────────────────────────────────

/** Maximum prompt length in characters before submission to the model. */
const MAX_PROMPT_LEN = 6_000;

// ─── buildWriterPrompt ────────────────────────────────────────────────────

/**
 * Build the final prompt for the interpolator writer model.
 *
 * Selects mode-appropriate template and enforces max prompt length.
 * Never throws — on error, returns a safe minimal-fallback prompt.
 */
export function buildWriterPrompt(input: ThreadStateForWriter): string {
  try {
    const mode: SummaryMode = input.summaryMode ?? 'minimal_fallback';

    let prompt: string;
    if (mode === 'normal') {
      prompt = buildNormalSummaryPrompt(input);
    } else if (mode === 'descriptive_fallback') {
      prompt = buildDescriptiveFallbackPrompt(input);
    } else {
      prompt = buildMinimalFallbackPrompt(input);
    }

    // Hard cap to prevent token overflow
    if (prompt.length > MAX_PROMPT_LEN) {
      return prompt.slice(0, MAX_PROMPT_LEN);
    }

    return prompt;
  } catch {
    // Safe minimal fallback on any error
    const handle = input?.rootPost?.handle ?? 'op';
    const text = (input?.rootPost?.text ?? '').slice(0, 100);
    return [
      `Summarize this post by @${handle}: "${text}"`,
      `Requirements: collapsedSummary ≤ 200 chars, mode: "minimal_fallback", abstained: false.`,
      `Respond in JSON matching InterpolatorWriteResult schema.`,
    ].join('\n');
  }
}

/**
 * Estimate token count for a prompt string (rough approximation: 4 chars/token).
 * Used for pre-flight checks before sending to model.
 */
export function estimateTokenCount(prompt: string): number {
  return Math.ceil((prompt?.length ?? 0) / 4);
}

/**
 * Returns true if the prompt is within safe token limits for the model.
 * Assumes a conservative 4096-token context window for the writer.
 */
export function promptWithinTokenLimit(prompt: string, maxTokens = 4_000): boolean {
  return estimateTokenCount(prompt) <= maxTokens;
}
