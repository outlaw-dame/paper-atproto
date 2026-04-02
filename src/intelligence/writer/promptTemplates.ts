// ─── Writer — Prompt Templates ────────────────────────────────────────────
// Mode-specific prompt templates for the writer model.
// Separated from the model client to keep prompt iteration clean.
//
// Templates are string factories — they receive structured input and produce
// a prompt string. No business logic here, only prompt composition.
//
// Design constraints:
//   • No raw user text injected without length caps and sanitization.
//   • No model output patterns in templates — those belong in promptBuilder.
//   • All contributor handles must be pre-sanitized before interpolation.
//   • Mode-specific templates must match the mode semantics exactly.

import type { ThreadStateForWriter } from '../llmContracts';
import { STYLE } from './styleGuide';

// ─── Helpers ──────────────────────────────────────────────────────────────

function cap(text: string, maxLen: number): string {
  return text.slice(0, maxLen);
}

function bulletList(items: string[], maxItems = 5): string {
  return items.slice(0, maxItems).map(i => `- ${i}`).join('\n');
}

// ─── Normal summary template ──────────────────────────────────────────────

export function buildNormalSummaryPrompt(input: ThreadStateForWriter): string {
  const rootText = cap(input.rootPost.text, 400);
  const opHandle = `@${input.rootPost.handle}`;
  const replyCount = input.visibleReplyCount ?? input.selectedComments.length;

  const commentLines = input.selectedComments.slice(0, 10).map(c =>
    `@${c.handle} [${c.role ?? 'unknown'}]: ${cap(c.text, 200)}`,
  ).join('\n');

  const contributorLines = input.topContributors.slice(0, 4).map(c =>
    `@${c.handle} (${c.role}): ${cap(c.stanceSummary, 80)}`,
  ).join('\n');

  const entityLines = input.safeEntities.slice(0, 6).map(e =>
    `${e.label} [${e.type}, confidence ${e.confidence.toFixed(2)}]`,
  ).join(', ');

  const factualLines = bulletList(input.factualHighlights.slice(0, 3));
  const changedLines = bulletList(input.whatChangedSignals.slice(0, 4));

  return [
    `You are writing a structured discussion summary for Glympse.`,
    ``,
    `## Root post`,
    `Author: ${opHandle}`,
    `Text: "${rootText}"`,
    ``,
    `## Thread data`,
    `Visible replies: ${replyCount}`,
    ``,
    `### Selected comments`,
    commentLines || '(none)',
    ``,
    `### Top contributors`,
    contributorLines || '(none)',
    ``,
    `### Key entities`,
    entityLines || '(none)',
    ``,
    `### Factual highlights`,
    factualLines || '(none)',
    ``,
    `### What changed`,
    changedLines || '(none)',
    ``,
    `## Instructions`,
    `Write a concise structured summary of this discussion. Requirements:`,
    `- collapsedSummary: ≤ ${STYLE.COLLAPSED_SUMMARY_MAX_LEN} chars. One to two sentences.`,
    `  Do NOT copy the root post verbatim. Interpret what the conversation is about.`,
    `- expandedSummary: ≤ ${STYLE.EXPANDED_SUMMARY_MAX_LEN} chars. Two to three sentences.`,
    `  Include key contributor perspectives and any factual grounding.`,
    `- whatChanged: up to ${STYLE.MAX_WHAT_CHANGED} short signals, each ≤ ${STYLE.WHAT_CHANGED_ITEM_MAX_LEN} chars.`,
    `- contributorBlurbs: up to ${STYLE.MAX_BLURBS} blurbs, each ≤ ${STYLE.BLURB_MAX_LEN} chars.`,
    `  Only name contributors who are listed in Top contributors above.`,
    `  Tie each blurb to what they actually said or contributed.`,
    `- abstained: false (you have sufficient context).`,
    `- mode: "normal"`,
    ``,
    `Respond in JSON matching the InterpolatorWriteResult schema.`,
  ].join('\n');
}

// ─── Descriptive fallback template ────────────────────────────────────────

export function buildDescriptiveFallbackPrompt(input: ThreadStateForWriter): string {
  const rootText = cap(input.rootPost.text, 300);
  const opHandle = `@${input.rootPost.handle}`;
  const replyCount = input.visibleReplyCount ?? input.selectedComments.length;

  const topComments = input.selectedComments.slice(0, 5).map(c =>
    `@${c.handle}: ${cap(c.text, 150)}`,
  ).join('\n');

  return [
    `You are writing a descriptive discussion summary for Glympse.`,
    `Interpretive confidence is low — describe what is observable, do not interpret.`,
    ``,
    `## Root post`,
    `Author: ${opHandle}`,
    `Text: "${rootText}"`,
    `Visible replies: ${replyCount}`,
    ``,
    `### Top visible replies`,
    topComments || '(none)',
    ``,
    `## Instructions`,
    `Write a descriptive (not interpretive) summary. Requirements:`,
    `- collapsedSummary: ≤ ${STYLE.COLLAPSED_SUMMARY_MAX_LEN} chars.`,
    `  Describe what ${opHandle} shared and how replies are responding.`,
    `  Do NOT make interpretive claims about meaning or outcome.`,
    `  Add: "This is an early or developing thread." at the end.`,
    `- expandedSummary: omit (set to undefined).`,
    `- whatChanged: up to 3 signals observable from the thread. No speculation.`,
    `- contributorBlurbs: up to 2, only if strongly evidenced by the reply text.`,
    `- abstained: false.`,
    `- mode: "descriptive_fallback"`,
    ``,
    `Respond in JSON matching the InterpolatorWriteResult schema.`,
  ].join('\n');
}

// ─── Minimal fallback template ────────────────────────────────────────────

export function buildMinimalFallbackPrompt(input: ThreadStateForWriter): string {
  const rootText = cap(input.rootPost.text, 200);
  const opHandle = `@${input.rootPost.handle}`;

  return [
    `You are writing a minimal discussion summary for Glympse.`,
    `Thread data is too sparse for a structured summary.`,
    ``,
    `## Root post`,
    `Author: ${opHandle}`,
    `Text: "${rootText}"`,
    ``,
    `## Instructions`,
    `- collapsedSummary: ≤ 200 chars. One sentence only.`,
    `  Describe what ${opHandle} shared without interpretation.`,
    `  End with: "Limited thread data available."`,
    `- expandedSummary: omit.`,
    `- whatChanged: empty array.`,
    `- contributorBlurbs: empty array.`,
    `- abstained: false.`,
    `- mode: "minimal_fallback"`,
    ``,
    `Respond in JSON matching the InterpolatorWriteResult schema.`,
  ].join('\n');
}

// ─── Contributor blurb prompt ─────────────────────────────────────────────

export function buildBlurbGenerationPrompt(
  handle: string,
  role: string,
  commentText: string,
  inclusionReason: string,
): string {
  return [
    `Generate a one-sentence contributor blurb for @${handle}.`,
    `Role: ${role}`,
    `Inclusion reason: ${inclusionReason}`,
    `What they said: "${cap(commentText, 200)}"`,
    ``,
    `Rules:`,
    `- ≤ ${STYLE.BLURB_MAX_LEN} characters`,
    `- Start with @${handle}`,
    `- Be specific — reference what they actually said or contributed`,
    `- Do not speculate or use generic role labels`,
    `- End with a period`,
    ``,
    `Return only the blurb string, no JSON wrapper.`,
  ].join('\n');
}
