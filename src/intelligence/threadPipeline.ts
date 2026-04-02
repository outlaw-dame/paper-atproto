// ─── Verified Thread Pipeline ─────────────────────────────────────────────
// Phase 3: wires the Phase 2 verification layer into the discussion pipeline.
//
// Entry point: runVerifiedThreadPipeline()
//
// Pipeline steps:
//   1. Run baseline Phase 1 scoring via runInterpolatorPipeline
//   2. Convert ContributionScore → ContributionScores (adds Phase 3 fields)
//   3. Select verification candidates (gated by shouldVerifyPost)
//   4. Verify candidates concurrently via verifyEvidence + withRetry
//   5. Merge VerificationOutcome into each score (18 factual fields + chips)
//   6. Verify root post (best-effort)
//   7. Return ThreadPipelineResult

import type {
  AtUri,
  ContributionScore,
  ContributionScores,
  ThreadInterpolatorState,
  ThreadPost,
} from './interpolatorTypes';
import type { VerificationEntityHint, VerificationMediaItem, VerificationOutcome, VerificationProviders, VerificationRequest } from './verification/types';
import type { ThreadNode } from '../lib/resolver/atproto';
import type { ConfidenceState, SummaryMode } from './llmContracts';
import { runInterpolatorPipeline, nodeToThreadPost } from './atprotoInterpolatorAdapter';
import { InMemoryVerificationCache, type VerificationCache } from './verification/cache';
import { mergeVerificationIntoContributionScore } from './verification/mergeVerificationIntoScore';
import { verifyEvidence } from './verification/verifyEvidence';
import { withRetry } from './verification/retry';
import { computeConfidenceState } from './confidence';
import { chooseSummaryMode } from './routing';
import { computeThreadChange, type ChangeReason } from './changeDetection';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ThreadPipelineResult {
  interpolator: ThreadInterpolatorState;
  scores: Record<AtUri, ContributionScores>;
  verificationByPost: Record<AtUri, VerificationOutcome>;
  rootVerification: VerificationOutcome | null;
  didMeaningfullyChange: boolean;
  /** 0–1 magnitude of the meaningful change. 0 when no change detected. */
  changeMagnitude: number;
  /** Structured reasons for why the thread changed, if it did. */
  changeReasons: ChangeReason[];
  /** Three-axis confidence state computed after scoring and verification. */
  confidence: ConfidenceState;
  /** Summary mode derived from confidence — used to build writer input and choose fallback. */
  summaryMode: SummaryMode;
}

export interface RunThreadPipelineOptions {
  input: {
    rootUri: string;
    rootText: string;
    rootPost?: ThreadPost;
    replies: ThreadNode[];
  };
  previous?: ThreadInterpolatorState | null;
  providers: VerificationProviders;
  cache?: VerificationCache;
  signal?: AbortSignal;
  verificationLimit?: number;
  verificationConcurrency?: number;
}

// ─── toContributionScores ─────────────────────────────────────────────────
// Converts a Phase 1 ContributionScore into a Phase 3 ContributionScores by
// deriving the new fields from existing evidence signals and role.

function toContributionScores(score: ContributionScore): ContributionScores {
  const citationStrength = score.evidenceSignals
    .filter(s => s.kind === 'citation')
    .reduce((sum, s) => sum + s.confidence, 0);

  const clarificationValue = score.role === 'clarifying'
    ? Math.max(score.usefulnessScore, 0.6)
    : Math.min(1, citationStrength * 0.4);

  return {
    uri: score.uri,
    role: score.role,
    finalInfluenceScore: score.usefulnessScore,
    clarificationValue,
    sourceSupport: score.factualContribution,
    visibleChips: [],
    factual: null,
    usefulnessScore: score.usefulnessScore,
    abuseScore: score.abuseScore,
    evidenceSignals: score.evidenceSignals,
    entityImpacts: score.entityImpacts,
    scoredAt: score.scoredAt,
    ...(score.userFeedback !== undefined ? { userFeedback: score.userFeedback } : {}),
  };
}

// ─── shouldVerifyPost ─────────────────────────────────────────────────────
// Returns true if this post is worth spending a verification call on.

function shouldVerifyPost(post: ThreadPost, score: ContributionScores): boolean {
  if (!post.text.trim()) return false;
  if (score.finalInfluenceScore >= 0.60) return true;
  if (score.clarificationValue >= 0.55) return true;
  if (score.sourceSupport >= 0.50) return true;
  if (score.role === 'rule_source' || score.role === 'source_bringer') return true;
  if ((post.embeds?.length ?? 0) > 0) return true;
  if ((post.media?.length ?? 0) > 0) return true;
  return false;
}

// ─── selectVerificationCandidates ────────────────────────────────────────
// Returns up to `limit` posts that pass the verification gate, sorted by
// finalInfluenceScore descending.

function selectVerificationCandidates(
  posts: ThreadPost[],
  scores: Record<AtUri, ContributionScores>,
  limit: number,
): ThreadPost[] {
  return [...posts]
    .filter(p => {
      const s = scores[p.uri];
      return s !== undefined && shouldVerifyPost(p, s);
    })
    .sort((a, b) => {
      const sa = scores[a.uri];
      const sb = scores[b.uri];
      return (sb?.finalInfluenceScore ?? 0) - (sa?.finalInfluenceScore ?? 0);
    })
    .slice(0, limit);
}

// ─── mapWithConcurrency ───────────────────────────────────────────────────
// Runs `fn` over `items` with at most `concurrency` in-flight calls at once.

async function mapWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await fn(items[i] as T);
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, worker));
}

// ─── toVerificationRequest ────────────────────────────────────────────────

function toVerificationRequest(post: ThreadPost, signal?: AbortSignal): VerificationRequest {
  const req: VerificationRequest = { postUri: post.uri, text: post.text };
  if (post.indexedAt !== undefined) req.createdAt = post.indexedAt;
  if (post.facets?.length) req.facets = post.facets;
  if (post.embeds?.length) req.embeds = post.embeds;
  if (post.media?.length) req.media = post.media as VerificationMediaItem[];
  if (post.entities?.length) req.entities = post.entities as VerificationEntityHint[];
  if (signal !== undefined) req.signal = signal;
  return req;
}

// ─── runVerifiedThreadPipeline ────────────────────────────────────────────

export async function runVerifiedThreadPipeline(
  options: RunThreadPipelineOptions,
): Promise<ThreadPipelineResult> {
  const {
    input,
    providers,
    signal,
    verificationLimit = 8,
    verificationConcurrency = 3,
  } = options;
  const cache = options.cache ?? new InMemoryVerificationCache();

  // Step 1: Run Phase 1 pipeline (sync)
  const interpolator = runInterpolatorPipeline({
    rootUri: input.rootUri,
    rootText: input.rootText,
    replies: input.replies,
    existingState: options.previous ?? null,
  });

  // Step 2: Convert Phase 1 ContributionScore → Phase 3 ContributionScores
  const scores: Record<AtUri, ContributionScores> = {};
  for (const [uri, score] of Object.entries(interpolator.replyScores)) {
    scores[uri as AtUri] = toContributionScores(score);
  }

  // Step 3: Convert replies to ThreadPost for verification
  const replyPosts = input.replies.map(node => nodeToThreadPost(node));

  // Step 4: Select verification candidates
  const candidates = selectVerificationCandidates(replyPosts, scores, verificationLimit);

  // Step 5: Verify candidates with concurrency control
  const verificationByPost: Record<AtUri, VerificationOutcome> = {};

  await mapWithConcurrency(candidates, async (post: ThreadPost) => {
    try {
      const request = toVerificationRequest(post, signal);
      const outcome = await withRetry(
        () => verifyEvidence(request, providers, undefined, { cache }),
        { retries: 2, ...(signal !== undefined ? { signal } : {}) },
      );
      verificationByPost[post.uri] = outcome;
      const current = scores[post.uri];
      if (current !== undefined) {
        scores[post.uri] = mergeVerificationIntoContributionScore(current, outcome);
      }
    } catch {
      // Verification failures are swallowed — scores remain at Phase 1 level
    }
  }, verificationConcurrency);

  // Step 6: Verify root post (best-effort)
  let rootVerification: VerificationOutcome | null = null;
  if (input.rootPost !== undefined && input.rootPost.text.trim()) {
    try {
      const rootRequest = toVerificationRequest(input.rootPost, signal);
      rootVerification = await withRetry(
        () => verifyEvidence(rootRequest, providers, undefined, { cache }),
        { retries: 2, ...(signal !== undefined ? { signal } : {}) },
      );
    } catch {
      // Root verification is best-effort
    }
  }

  const changeResult = computeThreadChange(options.previous ?? null, interpolator, scores);

  const confidence = computeConfidenceState(interpolator, scores);
  const summaryMode = chooseSummaryMode({
    surfaceConfidence: confidence.surfaceConfidence,
    interpretiveConfidence: confidence.interpretiveConfidence,
  });

  return {
    interpolator,
    scores,
    verificationByPost,
    rootVerification,
    didMeaningfullyChange: changeResult.didMeaningfullyChange,
    changeMagnitude: changeResult.changeMagnitude,
    changeReasons: changeResult.changeReasons,
    confidence,
    summaryMode,
  };
}
