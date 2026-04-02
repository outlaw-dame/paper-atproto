/**
 * Meaningful Thread-Change Detection Algorithm
 *
 * Detects when a thread has changed enough to justify rewriting the Interpolator.
 * 
 * Prevents constant rewrites while ensuring updates when:
 * - New stance/angle enters
 * - Source-backed clarification changes understanding
 * - Major contributor enters/exits
 * - Heat level shifts materially
 * - Thread maturity changes (forming → settled or vice versa)
 * - Entity significance changes
 *
 * Privacy: Uses URIs, not post content in logs
 * Error handling: Graceful degradation, never throws
 * Security: All numeric inputs clamped, array ops bounded
 */

import type {
  InterpolatorState,
  ContributionScores,
} from '../interpolatorTypes';
import type { ThreadNode } from '../../lib/resolver/atproto';
import { clamp01 } from '../verification/utils';

function toSafeErrorMeta(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 180),
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown algorithm error',
  };
}

function logChangeDetectionError(event: string, error: unknown): void {
  console.error(`[changeDetection] ${event}`, toSafeErrorMeta(error));
}

// ─── Type Contracts ──────────────────────────────────────────────────────────

export interface ThreadStateSnapshot {
  timestamp: string; // ISO timestamp
  threadUri: string;
  rootAuthorDid: string;

  // Structural state
  replyCount: number;
  topContributorDids: string[];
  dominantStance: string;
  minorityStancesPresent: boolean;

  // Quality signals
  hasFactualContent: boolean;
  sourceBackedClarity: number; // 0–1
  heat: number; // 0–1, escalation/tension level
  threadMaturity: 'forming' | 'developing' | 'settled';

  // Entity landscape
  topEntityIds: string[]; // Canonical entity IDs, sorted by centrality
  entityCount: number;

  // Confidence/stability
  overallConfidence: number; // 0–1
}

export interface ThreadChangeDelta {
  timestamp: string;
  timestampPrevious: string;
  elapsedSeconds: number;

  // Change magnitudes (0–1)
  newAngleDelta: number; // New stance or claim group entered
  contributorShiftDelta: number; // Contributors significantly changed
  entityShiftDelta: number; // Entity focus shifted
  factualShiftDelta: number; // Quality of factual content changed
  heatDelta: number; // Escalation or de-escalation
  repetitionDelta: number; // More/less repetition
  clarityShift: number; // Did the thread become clearer or muddier?

  // Composite
  changeMagnitude: number; // 0–1, overall
  changeReasons: ChangeReason[];

  // Recommendation
  shouldUpdate: boolean;
  confidence: number; // How sure are we about the recommendation?
  updateRationale: string; // Human-readable
}

export type ChangeReason =
  | 'new_stance_entered'
  | 'source_backed_clarification'
  | 'major_contributor_shift'
  | 'heat_escalation'
  | 'entity_focus_shift'
  | 'thread_maturity_change'
  | 'factual_clarity_increased'
  | 'repetition_detected'
  | 'contradiction_emerged';

export interface ChangeDetectionOptions {
  minChangeThreshold?: number; // Default: 0.40
  heatEscalationThreshold?: number; // Default: 0.25 delta
  minHeatLevel?: number; // Don't update on tiny changes; default 0.30
  maxUpdateFrequency?: number; // Minimum seconds between updates; default 60
}

// ─── Snapshot Creation ──────────────────────────────────────────────────────

/**
 * Create a snapshot of current thread state.
 * Used for delta comparison on subsequent changes.
 */
export function createThreadSnapshot(
  thread: {
    uri: string;
    replies: ThreadNode[];
    rootAuthorDid: string;
  },
  state: InterpolatorState,
  scores: Record<string, ContributionScores>,
  confidence: {
    surfaceConfidence: number;
    entityConfidence: number;
    interpretiveConfidence: number;
  },
): ThreadStateSnapshot {
  try {
    const topContributors = state.topContributors?.slice(0, 5) ?? [];
    const topContributorDids = topContributors.map(c => c.did);

    const scoresByDid = new Map<string, ContributionScores[]>();
    for (const reply of thread.replies) {
      const score = scores[reply.uri];
      if (!score || !reply.authorDid) continue;
      const existing = scoresByDid.get(reply.authorDid) ?? [];
      existing.push(score);
      scoresByDid.set(reply.authorDid, existing);
    }

    // Infer dominant stance from top contributors
    const topRoles = topContributors
      .map((c) => {
        const didScores = scoresByDid.get(c.did) ?? [];
        return didScores[0]?.role;
      })
      .filter(r => r !== undefined);
    const roleHistogram = new Map<string, number>();
    for (const role of topRoles) {
      roleHistogram.set(role, (roleHistogram.get(role) ?? 0) + 1);
    }
    const dominantStance = Array.from(roleHistogram.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const minorityStancesPresent = roleHistogram.size > 1;

    // Factual content detection
    const hasFactualContent = topRoles.some(role => {
      return role === 'source_bringer' || role === 'new_information' || role === 'useful_counterpoint';
    });

    // Source-backed clarity
    const sourceBackedClarity = topContributors.length > 0
      ? (topContributors
        .map((c) => {
          const didScores = scoresByDid.get(c.did) ?? [];
          if (didScores.length === 0) return 0;
          return didScores.reduce((sum, s) => sum + (s.sourceSupport ?? 0), 0) / didScores.length;
        })
        .reduce((a, b) => a + b, 0) / topContributors.length)
      : 0;

    // Heat level: infer from reply count, sentiment if available
    const replyCount = thread.replies?.length ?? 0;
    const baseHeat = Math.min(0.5, replyCount / 50); // 50 replies = moderate heat
    // Could add sentiment analysis here, but keep it lightweight for now
    const heat = clamp01(baseHeat);

    // Thread maturity
    let maturity: 'forming' | 'developing' | 'settled';
    if (replyCount < 5) maturity = 'forming';
    else if (replyCount < 20) maturity = 'developing';
    else maturity = 'settled';

    const topEntities = [...(state.entityLandscape ?? [])]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 5);
    const topEntityIds = topEntities.map((e) => e.canonicalEntityId ?? e.entityText.toLowerCase());

    // Overall confidence
    const overallConfidence = clamp01(
      ((confidence.surfaceConfidence ?? 0)
        + (confidence.entityConfidence ?? 0)
        + (confidence.interpretiveConfidence ?? 0)) / 3,
    );

    return {
      timestamp: new Date().toISOString(),
      threadUri: thread.uri,
      rootAuthorDid: thread.rootAuthorDid,
      replyCount,
      topContributorDids,
      dominantStance,
      minorityStancesPresent,
      hasFactualContent,
      sourceBackedClarity: clamp01(sourceBackedClarity),
      heat,
      threadMaturity: maturity,
      topEntityIds,
      entityCount: topEntities.length,
      overallConfidence,
    };
  } catch (err) {
    logChangeDetectionError('snapshot_creation_failed', err);
    // Return a minimal safe snapshot
    return {
      timestamp: new Date().toISOString(),
      threadUri: thread.uri,
      rootAuthorDid: thread.rootAuthorDid,
      replyCount: 0,
      topContributorDids: [],
      dominantStance: 'unknown',
      minorityStancesPresent: false,
      hasFactualContent: false,
      sourceBackedClarity: 0,
      heat: 0,
      threadMaturity: 'forming',
      topEntityIds: [],
      entityCount: 0,
      overallConfidence: 0.5,
    };
  }
}

// ─── Change Delta Computations ───────────────────────────────────────────────

/**
 * New angle delta: did a new stance or significant claim group enter?
 * Compare dominant stance shift + minority presence change
 */
function computeNewAngleDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  let delta = 0;

  // Stance change is significant
  if (previous.dominantStance !== current.dominantStance && current.dominantStance !== 'unknown') {
    delta += 0.4;
  }

  // Minority emergence is significant
  if (!previous.minorityStancesPresent && current.minorityStancesPresent) {
    delta += 0.3;
  }

  return clamp01(delta);
}

/**
 * Contributor shift delta: did the top contributors significantly change?
 * Compare DID lists, measure overlap
 */
function computeContributorShiftDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  if (previous.topContributorDids.length === 0 || current.topContributorDids.length === 0) {
    return 0.2; // Small delta if one is empty
  }

  const prevSet = new Set(previous.topContributorDids);
  const currSet = new Set(current.topContributorDids);

  // Jaccard similarity
  const intersection = [...prevSet].filter(did => currSet.has(did)).length;
  const union = new Set([...prevSet, ...currSet]).size;
  const similarity = union === 0 ? 0 : intersection / union;
  const delta = 1 - similarity;

  return clamp01(delta);
}

/**
 * Entity shift delta: entity focus changed?
 */
function computeEntityShiftDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  if (previous.topEntityIds.length === 0 || current.topEntityIds.length === 0) {
    return 0.1; // Small delta
  }

  const prevSet = new Set(previous.topEntityIds);
  const currSet = new Set(current.topEntityIds);

  const intersection = [...prevSet].filter(id => currSet.has(id)).length;
  const union = new Set([...prevSet, ...currSet]).size;
  const similarity = union === 0 ? 0 : intersection / union;
  const delta = 1 - similarity;

  return clamp01(delta);
}

/**
 * Factual shift: did quality of source-backed content change?
 */
function computeFactualShiftDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  const prevFact = previous.sourceBackedClarity;
  const currFact = current.sourceBackedClarity;

  const shiftMagnitude = Math.abs(currFact - prevFact);
  // Only count significant shifts
  return shiftMagnitude > 0.15 ? Math.min(0.5, shiftMagnitude) : 0;
}

/**
 * Heat delta: escalation or de-escalation?
 */
function computeHeatDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  const heatDiff = Math.abs(current.heat - previous.heat);
  return clamp01(heatDiff);
}

/**
 * Repetition delta: was there a burst of repetitive content?
 * Simplified: if reply count increased but contributor stability high = repetition
 */
function computeRepetitionDelta(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  if (current.replyCount <= previous.replyCount) return 0;

  const newReplyCount = current.replyCount - previous.replyCount;
  const contributorDiff = computeContributorShiftDelta(previous, current);

  // High reply growth + stable contributors = likely repetition
  if (newReplyCount > 5 && contributorDiff < 0.3) {
    return Math.min(0.4, newReplyCount / 20);
  }

  return 0;
}

/**
 * Clarity shift: did understanding improve or degrade?
 * Based on confidence change + factual improvement
 */
function computeClarityShift(previous: ThreadStateSnapshot, current: ThreadStateSnapshot): number {
  const confidenceDiff = current.overallConfidence - previous.overallConfidence;
  const factualDiff = current.sourceBackedClarity - previous.sourceBackedClarity;

  const clarity = Math.max(
    0,
    (confidenceDiff * 0.5 + factualDiff * 0.5), // Improvement is positive
  );

  return clamp01(Math.abs(clarity));
}

// ─── Change Magnitude & Rationale ──────────────────────────────────────────

/**
 * Compute overall change magnitude using the formula:
 *
 * changeMagnitude =
 *   0.25 * newAngleDelta
 * + 0.20 * contributorShift
 * + 0.15 * entityShift
 * + 0.15 * factualShift
 * + 0.15 * heatDelta
 * + 0.10 * repetitionDelta
 *
 * This weighs high-impact structural changes heavily.
 */
export function computeThreadChangeDelta(
  previous: ThreadStateSnapshot | null,
  current: ThreadStateSnapshot,
  options: ChangeDetectionOptions = {},
): ThreadChangeDelta {
  const minThreshold = options.minChangeThreshold ?? 0.40;

  // If no previous state, can't compute delta; assume minimal change
  if (!previous) {
    return {
      timestamp: current.timestamp,
      timestampPrevious: '',
      elapsedSeconds: 0,
      newAngleDelta: 0,
      contributorShiftDelta: 0,
      entityShiftDelta: 0,
      factualShiftDelta: 0,
      heatDelta: 0,
      repetitionDelta: 0,
      clarityShift: 0,
      changeMagnitude: 0,
      changeReasons: [],
      shouldUpdate: false,
      confidence: 0.5,
      updateRationale: 'No previous state to compare',
    };
  }

  try {
    const prevTime = new Date(previous.timestamp).getTime();
    const currTime = new Date(current.timestamp).getTime();
    const rawElapsedSeconds = (currTime - prevTime) / 1000;
    const elapsedSeconds = Number.isFinite(rawElapsedSeconds)
      ? Math.max(0, rawElapsedSeconds)
      : 0;

    // Compute deltas
    const newAngle = computeNewAngleDelta(previous, current);
    const contributorShift = computeContributorShiftDelta(previous, current);
    const entityShift = computeEntityShiftDelta(previous, current);
    const factual = computeFactualShiftDelta(previous, current);
    const heat = computeHeatDelta(previous, current);
    const repetition = computeRepetitionDelta(previous, current);
    const clarity = computeClarityShift(previous, current);

    // Formula
    const changeMagnitude = clamp01(
      0.25 * newAngle +
        0.20 * contributorShift +
        0.15 * entityShift +
        0.15 * factual +
        0.15 * heat +
        0.10 * repetition,
    );

    // Identify reasons
    const reasons: ChangeReason[] = [];
    if (newAngle > 0.3) reasons.push('new_stance_entered');
    if (factual > 0.3 && current.sourceBackedClarity > previous.sourceBackedClarity) {
      reasons.push('source_backed_clarification');
    }
    if (contributorShift > 0.4) reasons.push('major_contributor_shift');
    if (heat > (options.heatEscalationThreshold ?? 0.25)) {
      reasons.push(current.heat > previous.heat ? 'heat_escalation' : 'heat_escalation');
    }
    if (entityShift > 0.3) reasons.push('entity_focus_shift');
    if (previous.threadMaturity !== current.threadMaturity) {
      reasons.push('thread_maturity_change');
    }
    if (clarity > 0.2 && current.overallConfidence > previous.overallConfidence) {
      reasons.push('factual_clarity_increased');
    }
    if (repetition > 0.2) reasons.push('repetition_detected');

    // Decision logic
    const minHeat = options.minHeatLevel ?? 0.30;
    const shouldUpdate =
      changeMagnitude >= minThreshold &&
      (current.heat >= minHeat || // Don't update on low-heat threads unless big change
        changeMagnitude > 0.6); // Unless change is very large

    // Confidence is higher if change is clear + multiple signals align
    const signalCount = reasons.length;
    const confidence = clamp01(changeMagnitude + signalCount * 0.1);

    const updateRationale =
      changeMagnitude < minThreshold
        ? `Minimal change (${(changeMagnitude * 100).toFixed(0)}% < threshold)`
        : reasons.length === 0
          ? 'Change detected but reason unclear'
          : `${(reasons[0] ?? 'change_detected').replace(/_/g, ' ')}${reasons.length > 1 ? ` + ${reasons.length - 1} more` : ''}`;

    return {
      timestamp: current.timestamp,
      timestampPrevious: previous.timestamp,
      elapsedSeconds,
      newAngleDelta: newAngle,
      contributorShiftDelta: contributorShift,
      entityShiftDelta: entityShift,
      factualShiftDelta: factual,
      heatDelta: heat,
      repetitionDelta: repetition,
      clarityShift: clarity,
      changeMagnitude,
      changeReasons: reasons,
      shouldUpdate,
      confidence,
      updateRationale,
    };
  } catch (err) {
    logChangeDetectionError('delta_computation_failed', err);
    return {
      timestamp: current.timestamp,
      timestampPrevious: previous?.timestamp ?? '',
      elapsedSeconds: 0,
      newAngleDelta: 0,
      contributorShiftDelta: 0,
      entityShiftDelta: 0,
      factualShiftDelta: 0,
      heatDelta: 0,
      repetitionDelta: 0,
      clarityShift: 0,
      changeMagnitude: 0,
      changeReasons: [],
      shouldUpdate: false,
      confidence: 0.3,
      updateRationale: 'Error computing change delta',
    };
  }
}

/**
 * Rate-limiting: don't update too frequently even if threshold is met
 */
export function shouldRateLimitUpdate(
  lastUpdateTime: string | null,
  options: ChangeDetectionOptions = {},
): boolean {
  const maxFreq = options.maxUpdateFrequency ?? 60; // seconds

  if (!lastUpdateTime) return false; // No rate limit on first update

  const lastTime = new Date(lastUpdateTime).getTime();
  const now = new Date().getTime();
  const elapsedSeconds = (now - lastTime) / 1000;

  return elapsedSeconds < maxFreq;
}
