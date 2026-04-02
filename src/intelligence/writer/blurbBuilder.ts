// ─── Writer — Contributor Blurb Builder ───────────────────────────────────
// Builds deterministic contributor blurbs that are:
//   • Tied to the contributor's actual whyNamed / inclusion reason
//   • Short (≤ BLURB_MAX_LEN chars)
//   • Specific (not generic role labels)
//   • Role-aware but not repetitive
//   • Non-speculative
//
// Blurbs are used both as fallback content and as structured hints to the
// writer model to anchor its own blurb generation.
//
// Design constraints:
//   • Pure functions — no I/O.
//   • Fail-closed on any error.
//   • No raw text in logs.

import type { WriterContributor, WriterComment } from '../llmContracts';
import type { ContributorInclusionReason } from '../contributorSelection';
import { STYLE, ROLE_LABELS } from './styleGuide';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ContributorBlurb {
  handle: string;
  blurb: string;
  /** Which inclusion reason was used to generate this blurb. */
  reason: ContributorInclusionReason | 'role_default';
}

// ─── Reason → blurb template ──────────────────────────────────────────────

const REASON_TO_TEMPLATE: Record<ContributorInclusionReason, string> = {
  clarified_core_issue: 'helped clarify the key issue',
  introduced_new_angle: 'introduced a new angle to the conversation',
  cited_source: 'brought a source to the thread',
  represented_major_viewpoint: 'represented a major viewpoint in the discussion',
  shifted_thread_direction: 'shifted the direction of the thread',
  op_participated: 'started this thread',
};

// ─── truncateAtBoundary ───────────────────────────────────────────────────

function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace >= Math.floor(maxLen * 0.70)
    ? `${slice.slice(0, lastSpace)}…`
    : `${slice}…`;
}

function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
}

// ─── buildBlurbFromReason ─────────────────────────────────────────────────

/**
 * Build a contributor blurb from a typed inclusion reason.
 * Returns a short, role-grounded sentence.
 */
export function buildBlurbFromReason(
  contributor: WriterContributor,
  reason: ContributorInclusionReason,
): ContributorBlurb {
  try {
    const template = REASON_TO_TEMPLATE[reason];
    const blurb = truncateAtBoundary(
      `@${sanitize(contributor.handle)} ${template}.`,
      STYLE.BLURB_MAX_LEN,
    );
    return { handle: contributor.handle, blurb, reason };
  } catch {
    return {
      handle: contributor.handle ?? '',
      blurb: '',
      reason,
    };
  }
}

// ─── buildBlurbFromRole ───────────────────────────────────────────────────

/**
 * Build a contributor blurb from the contributor's writer role when no
 * typed inclusion reason is available.
 */
export function buildBlurbFromRole(contributor: WriterContributor): ContributorBlurb {
  try {
    const roleLabel = ROLE_LABELS[contributor.role] ?? 'contributed to the discussion';
    const blurb = truncateAtBoundary(
      `@${sanitize(contributor.handle)} ${roleLabel}.`,
      STYLE.BLURB_MAX_LEN,
    );
    return { handle: contributor.handle, blurb, reason: 'role_default' };
  } catch {
    return { handle: contributor.handle ?? '', blurb: '', reason: 'role_default' };
  }
}

// ─── buildBlurbFromComment ────────────────────────────────────────────────

/**
 * Build a contributor blurb from one of their actual comment texts.
 * Used when neither inclusion reason nor role are strong enough anchors.
 */
export function buildBlurbFromComment(
  contributor: WriterContributor,
  comment: WriterComment,
): ContributorBlurb {
  try {
    const text = sanitize(comment.text).slice(0, 100);
    if (text.length < 15) return buildBlurbFromRole(contributor);
    const blurb = truncateAtBoundary(
      `@${sanitize(contributor.handle)}: "${text}"`,
      STYLE.BLURB_MAX_LEN,
    );
    return { handle: contributor.handle, blurb, reason: 'role_default' };
  } catch {
    return { handle: contributor.handle ?? '', blurb: '', reason: 'role_default' };
  }
}

// ─── buildContributorBlurbs ───────────────────────────────────────────────

/**
 * Build a full set of contributor blurbs for the writer.
 *
 * Priority order:
 *   1. Inclusion reason (most specific)
 *   2. Role label
 *   3. Top comment text (most concrete)
 *
 * @param contributors  — selected writer contributors
 * @param inclusionReasonMap — map from handle → ContributorInclusionReason
 * @param commentsByHandle   — map from handle → best WriterComment
 *
 * Never throws — returns empty array on error.
 */
export function buildContributorBlurbs(
  contributors: WriterContributor[],
  inclusionReasonMap: Record<string, ContributorInclusionReason>,
  commentsByHandle: Record<string, WriterComment>,
): ContributorBlurb[] {
  if (!contributors?.length) return [];

  try {
    return contributors
      .slice(0, STYLE.MAX_BLURBS)
      .map(contributor => {
        const reason = inclusionReasonMap[contributor.handle];
        if (reason) return buildBlurbFromReason(contributor, reason);

        const comment = commentsByHandle[contributor.handle];
        if (comment && comment.text.length >= 20) {
          return buildBlurbFromComment(contributor, comment);
        }

        return buildBlurbFromRole(contributor);
      })
      .filter(b => b.blurb.length > 0);
  } catch {
    return [];
  }
}
