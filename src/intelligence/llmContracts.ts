// ─── LLM Contracts — Narwhal v3 ───────────────────────────────────────────
// All model I/O types shared between client intelligence layer,
// server routes, and model services.
// These types flow through: routing → confidence → writerInput → modelClient → server.

// ─── Confidence ───────────────────────────────────────────────────────────
export interface ConfidenceState {
  /** How well we can describe what is plainly happening in root + visible replies. */
  surfaceConfidence: number;
  /** How confident we are that resolved entities are real, central, and safe to name. */
  entityConfidence: number;
  /** How confident we are about the deeper thread meaning, dominant theme, narrative. */
  interpretiveConfidence: number;
}

// ─── Summary mode ─────────────────────────────────────────────────────────
export type SummaryMode = 'normal' | 'descriptive_fallback' | 'minimal_fallback';

// ─── ThreadStateForWriter ─────────────────────────────────────────────────
export interface WriterRootPost {
  uri: string;
  handle: string;
  displayName?: string | undefined;
  text: string;
  createdAt: string;
}

export interface WriterComment {
  uri: string;
  handle: string;
  displayName?: string | undefined;
  text: string;
  impactScore: number;
  role?: string | undefined;
  liked?: number | undefined;
  replied?: number | undefined;
}

export interface WriterContributor {
  did?: string | undefined;
  handle: string;
  displayName?: string | undefined;
  role:
    | 'op'
    | 'clarifier'
    | 'source-bringer'
    | 'counterpoint'
    | 'context-setter'
    | 'emotional-reaction'
    | 'rule-source'
    | 'question-raiser';
  impactScore: number;
  stanceSummary: string;
}

export interface WriterEntity {
  id: string;
  label: string;
  type: 'topic' | 'event' | 'person' | 'team' | 'organization' | 'product' | 'rule' | 'source';
  confidence: number;
  impact: number;
}

export interface WriterMediaFinding {
  mediaType: 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';
  summary: string;
  confidence: number;
  extractedText?: string | undefined;
  cautionFlags?: string[] | undefined;
}

export interface ThreadStateForWriter {
  threadId: string;
  summaryMode: SummaryMode;
  confidence: ConfidenceState;
  rootPost: WriterRootPost;
  selectedComments: WriterComment[];
  topContributors: WriterContributor[];
  safeEntities: WriterEntity[];
  factualHighlights: string[];
  whatChangedSignals: string[];
  mediaFindings?: WriterMediaFinding[] | undefined;
}

// ─── Interpolator writer result ───────────────────────────────────────────
export interface InterpolatorWriteResult {
  collapsedSummary: string;
  expandedSummary?: string | undefined;
  whatChanged: string[];
  contributorBlurbs: Array<{ handle: string; blurb: string }>;
  abstained: boolean;
  /** Which mode the writer operated in. */
  mode: SummaryMode;
}

// ─── Multimodal ───────────────────────────────────────────────────────────
export interface MediaAnalysisRequest {
  threadId: string;
  mediaUrl: string;
  mediaAlt?: string | undefined;
  nearbyText: string;
  candidateEntities: string[];
  factualHints: string[];
}

export interface MediaAnalysisResult {
  mediaCentrality: number;
  mediaType: 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';
  extractedText?: string | undefined;
  mediaSummary: string;
  candidateEntities: string[];
  confidence: number;
  cautionFlags: string[];
}

// ─── Explore synopsis ─────────────────────────────────────────────────────
export interface ExploreSynopsisRequest {
  storyId: string;
  titleHint?: string | undefined;
  candidatePosts: Array<{
    uri: string;
    handle: string;
    text: string;
    impactScore: number;
  }>;
  safeEntities: WriterEntity[];
  factualHighlights: string[];
  mediaFindings?: WriterMediaFinding[] | undefined;
  confidence: ConfidenceState;
}

export interface ExploreSynopsisResult {
  synopsis: string;
  shortSynopsis?: string | undefined;
  abstained: boolean;
}

// ─── Entity sheet ─────────────────────────────────────────────────────────
export interface EntitySnippet {
  id: string;
  label: string;
  type: string;
  snippet: string;
  relatedPostUris: string[];
  relatedSourceUrls: string[];
  relatedPeople: Array<{ handle: string; reason: string }>;
}
