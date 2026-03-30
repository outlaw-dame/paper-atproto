import type { ThreadNode } from '../lib/resolver/atproto.js';
export type ContributionRole = 'clarifying' | 'new_information' | 'direct_response' | 'repetitive' | 'provocative' | 'useful_counterpoint' | 'story_worthy' | 'rule_source' | 'source_bringer' | 'unknown';
export type EvidenceKind = 'citation' | 'data_point' | 'firsthand' | 'counterexample' | 'speculation';
export interface EvidenceSignal {
    kind: EvidenceKind;
    confidence: number;
    sourceUrl?: string;
    extractedText?: string;
}
export type EntityKind = 'person' | 'org' | 'place' | 'concept' | 'claim';
export interface EntityImpact {
    entityText: string;
    entityKind: EntityKind;
    sentimentShift: number;
    isNewEntity: boolean;
    mentionCount: number;
    canonicalEntityId?: string;
    canonicalLabel?: string;
    matchConfidence?: number;
}
export interface ContributorImpact {
    did: string;
    handle?: string;
    totalReplies: number;
    avgUsefulnessScore: number;
    dominantRole: ContributionRole;
    factualContributions: number;
}
export interface ContributionScore {
    uri: string;
    role: ContributionRole;
    usefulnessScore: number;
    abuseScore: number;
    userFeedback?: 'clarifying' | 'new_to_me' | 'provocative' | 'aha';
    scoredAt: string;
    evidenceSignals: EvidenceSignal[];
    entityImpacts: EntityImpact[];
    factualContribution: number;
    knownFactCheckMatch: boolean;
    factCheckMatchConfidence: number;
    mediaContextConfidence: number;
}
export type InterpolatorTriggerKind = 'new_replies' | 'user_feedback' | 'new_entity' | 'high_evidence' | 'heat_spike';
export interface InterpolatorTrigger {
    kind: InterpolatorTriggerKind;
    replyUri?: string;
    payload?: unknown;
    triggeredAt: string;
}
export interface InterpolatorState {
    rootUri: string;
    summaryText: string;
    salientClaims: string[];
    salientContributors: string[];
    clarificationsAdded: string[];
    newAnglesAdded: string[];
    repetitionLevel: number;
    heatLevel: number;
    sourceSupportPresent: boolean;
    updatedAt: string;
    version: number;
    replyScores: Record<string, ContributionScore>;
    entityLandscape: EntityImpact[];
    topContributors: ContributorImpact[];
    evidencePresent: boolean;
    factualSignalPresent: boolean;
    lastTrigger: InterpolatorTrigger | null;
    triggerHistory: InterpolatorTrigger[];
}
export interface InterpolatorInput {
    rootUri: string;
    rootText: string;
    replies: ThreadNode[];
    existingState?: InterpolatorState | null;
}
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
    entities?: Array<{
        id: string;
        label: string;
        type: string;
        confidence: number;
    }>;
    facets?: Array<{
        type: 'link' | 'mention' | 'tag';
        text: string;
        uri?: string;
    }>;
}
export type VisibleChipKind = 'fact-checked' | 'source-backed' | 'direct-quote' | 'media-verified' | 'contested' | 'clarification' | 'well-supported' | 'partially-supported' | 'corrective-context';
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
    usefulnessScore: number;
    abuseScore: number;
    evidenceSignals: EvidenceSignal[];
    entityImpacts: EntityImpact[];
    scoredAt: string;
    userFeedback?: 'clarifying' | 'new_to_me' | 'provocative' | 'aha';
}
/** Phase 3 interpolator state — type alias to InterpolatorState for forward compatibility. */
export type ThreadInterpolatorState = InterpolatorState;
//# sourceMappingURL=interpolatorTypes.d.ts.map