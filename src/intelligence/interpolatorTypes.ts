// ─── Interpolator Pipeline — Type Contracts ───────────────────────────────
// Full type contract for the entity-aware, contributor-aware, and
// evidence-aware Interpolator pipeline.
//
// Design constraints:
//   • Hard moderation signals (abuseScore) are kept SEPARATE from ranking
//   • factualContribution is a POSITIVE signal derived from local evidence
//   • knownFactCheckMatch / factCheckMatchConfidence / mediaContextConfidence
//     are present in the contract but Phase 1 populates them from local
//     thread evidence only — not from a live external verifier service

import type { ThreadNode } from '../lib/resolver/atproto.js';

// ─── ContributionRole ─────────────────────────────────────────────────────
export type ContributionRole =
  | 'clarifying'          // adds clarity to the discussion
  | 'new_information'     // introduces a fact or angle not yet present
  | 'direct_response'     // directly addresses the original post
  | 'repetitive'          // repeats something already said
  | 'provocative'         // raises heat without adding signal
  | 'useful_counterpoint' // good-faith disagreement with evidence
  | 'story_worthy'        // notable enough to surface in a story card
  | 'rule_source'         // Phase 3: cites an official rule or policy source
  | 'source_bringer'      // Phase 3: brings a primary source or key evidence
  | 'unknown';            // not yet scored

// ─── Evidence signals ─────────────────────────────────────────────────────
export type EvidenceKind =
  | 'citation'       // explicit URL referencing an external source
  | 'data_point'     // numeric claim with supporting context
  | 'firsthand'      // author claims direct experience
  | 'counterexample' // concrete example contradicting a prior claim
  | 'speculation';   // clearly hedged opinion (weak / negative signal)

export interface EvidenceSignal {
  kind: EvidenceKind;
  confidence: number;      // 0–1
  sourceUrl?: string;      // present for 'citation' kind
  extractedText?: string;  // short excerpt that triggered detection
}

// ─── Entity impact ────────────────────────────────────────────────────────
export type EntityKind = 'person' | 'org' | 'place' | 'concept' | 'claim';

export interface EntityImpact {
  entityText: string;
  entityKind: EntityKind;
  sentimentShift: number;  // −1 (negative) → 0 (neutral) → +1 (positive)
  isNewEntity: boolean;    // true if introduced for the first time in this reply
  mentionCount: number;
  canonicalEntityId?: string;
  canonicalLabel?: string;
  matchConfidence?: number;
}

// ─── Contributor impact ───────────────────────────────────────────────────
export interface ContributorImpact {
  did: string;
  handle?: string;
  totalReplies: number;
  avgUsefulnessScore: number;
  dominantRole: ContributionRole;
  factualContributions: number;  // count of replies with factualContribution > 0.3
}

// ─── ContributionScore ────────────────────────────────────────────────────
// Superset of the legacy ReplyScore. All legacy fields are preserved so
// existing callers (ContributionCard, filter logic) continue to work.
export interface ContributionScore {
  // ── Legacy fields ────────────────────────────────────────────────────
  uri: string;
  role: ContributionRole;
  usefulnessScore: number;   // 0–1
  abuseScore: number;        // 0–1, kept separate from ranking (Phase 2: Detoxify)
  userFeedback?: 'clarifying' | 'new_to_me' | 'provocative' | 'aha';
  scoredAt: string;          // ISO timestamp

  // ── Richer fields (this phase) ────────────────────────────────────────
  evidenceSignals: EvidenceSignal[];
  entityImpacts: EntityImpact[];

  // factualContribution: POSITIVE evidence-derived signal.
  // Derived from local thread evidence in Phase 1 only.
  // Phase 2: augment with live retrieval/verification layer.
  factualContribution: number;  // 0–1

  // These three fields are present in the contract but are NOT yet
  // populated from a live external verification service.
  // Phase 1: derived conservatively from local thread evidence only.
  // Phase 2: replace with server-side fact-check lookup + media provenance.
  knownFactCheckMatch: boolean;
  factCheckMatchConfidence: number;  // 0–1
  mediaContextConfidence: number;    // 0–1
}

// ─── Interpolator triggers ────────────────────────────────────────────────
// An update is only applied when a meaningful trigger is detected,
// preventing trivial re-computations on every incoming reply.
export type InterpolatorTriggerKind =
  | 'new_replies'    // a batch of new replies arrived
  | 'user_feedback'  // the user interacted with a reply
  | 'new_entity'     // a previously unseen entity appeared
  | 'high_evidence'  // a reply with strong evidence signals arrived
  | 'heat_spike';    // heatLevel crossed a meaningful threshold

export interface InterpolatorTrigger {
  kind: InterpolatorTriggerKind;
  replyUri?: string;
  payload?: unknown;
  triggeredAt: string;  // ISO timestamp
}

// ─── InterpolatorState ────────────────────────────────────────────────────
// The canonical state shape owned by threadStore.
// Extends the legacy ThreadState fields so all existing readers work.
export interface InterpolatorState {
  rootUri: string;

  // ── Legacy summary fields ────────────────────────────────────────────
  summaryText: string;
  salientClaims: string[];
  salientContributors: string[];  // DIDs of high-usefulness contributors
  clarificationsAdded: string[];
  newAnglesAdded: string[];
  repetitionLevel: number;        // 0–1
  heatLevel: number;              // 0–1
  sourceSupportPresent: boolean;
  updatedAt: string;              // ISO timestamp
  version: number;

  // replyScores now holds ContributionScore (superset of legacy ReplyScore)
  replyScores: Record<string, ContributionScore>;

  // ── Richer Interpolator fields ────────────────────────────────────────
  entityLandscape: EntityImpact[];       // merged entity map across all replies
  topContributors: ContributorImpact[];  // ranked by avgUsefulnessScore
  evidencePresent: boolean;              // any non-speculative evidence signal
  factualSignalPresent: boolean;         // any reply with factualContribution > 0.3
  lastTrigger: InterpolatorTrigger | null;
  triggerHistory: InterpolatorTrigger[]; // last 20 triggers
}

// ─── Pipeline input ───────────────────────────────────────────────────────
export interface InterpolatorInput {
  rootUri: string;
  rootText: string;
  replies: ThreadNode[];
  existingState?: InterpolatorState | null;
}

// ─── Phase 3: Thread Pipeline Types ────────────────────────────────────────

/** AT-Protocol URI string (e.g. "at://did:plc:…/app.bsky.feed.post/…") */
export type AtUri = string;

export interface ThreadMediaItem {
  url: string;
  alt?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

/** Normalised view of an ATProto post used throughout the Phase 3 pipeline. */
export interface ThreadPost {
  uri: AtUri;
  did: string;
  handle?: string;
  displayName?: string;
  text: string;
  indexedAt?: string;
  likeCount?: number;
  replyCount?: number;
  embeds?: Array<{
    url: string;
    domain?: string;
    title?: string;
    description?: string;
    mimeType?: string;
  }>;
  media?: ThreadMediaItem[];
  entities?: Array<{ id: string; label: string; type: string; confidence: number }>;
  facets?: Array<{ type: 'link' | 'mention' | 'tag'; text: string; uri?: string }>;
}

export type VisibleChipKind =
  | 'fact-checked'
  | 'source-backed'
  | 'direct-quote'
  | 'media-verified'
  | 'contested'
  | 'clarification'
  | 'well-supported'
  | 'partially-supported'
  | 'corrective-context';

export interface VisibleChip {
  kind: VisibleChipKind;
  label: string;
  confidence?: number;
}

/** All 18 factual sub-fields derived from a completed VerificationOutcome. */
export interface FactualEvidence {
  claimPresent: boolean;
  claimType: string;
  knownFactCheckMatch: boolean;
  factCheckMatchConfidence: number;
  sourcePresence: number;
  sourceType: string;
  sourceDomain?: string;
  sourceQuality: number;
  quoteFidelity: number;
  corroborationLevel: number;
  contradictionLevel: number;
  mediaContextConfidence: number;
  entityGrounding: number;
  contextValue: number;
  correctionValue: number;
  citedUrls: string[];
  quotedTextSpans: string[];
  factualContributionScore: number;
  factualConfidence: number;
  factualState: string;
  reasons: string[];
}

/**
 * Phase 3 per-post score. Superset of ContributionScore — all legacy fields
 * are retained so existing UI code (ContributionCard, filter logic) continues
 * to work without changes. New fields are added alongside the old ones.
 */
export interface ContributionScores {
  uri: AtUri;
  role: ContributionRole;
  /** Phase 1 usefulnessScore, boosted by 0.20 × factualContributionScore × factualConfidence after verification. */
  finalInfluenceScore: number;
  /** 0–1: how much this post clarifies the thread (used for verification gating). */
  clarificationValue: number;
  /** 0–1: source quality/presence signal (used for verification gating). */
  sourceSupport: number;
  /** UI chips derived from verification results. Empty until verification runs. */
  visibleChips: VisibleChip[];
  /** Full factual evidence object. null until this post has been verified. */
  factual: FactualEvidence | null;
  // ── Backward-compat fields from ContributionScore ──────────────────────
  usefulnessScore: number;
  abuseScore: number;
  evidenceSignals: EvidenceSignal[];
  entityImpacts: EntityImpact[];
  scoredAt: string;
  userFeedback?: 'clarifying' | 'new_to_me' | 'provocative' | 'aha';
}

/** Phase 3 interpolator state — type alias to InterpolatorState for forward compatibility. */
export type ThreadInterpolatorState = InterpolatorState;
