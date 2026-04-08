// ─── Update Interpolator State — Meaningful Trigger Detection ─────────────
// Decides whether an incoming batch warrants an Interpolator update.
// Prevents trivial re-computations on every single new reply.
//
// An update is "meaningful" when any of the following hold:
//   • This is the first time the thread is being processed (version 0)
//   • 3 or more new replies have arrived since the last update
//   • Any new reply carries strong evidence (factualContribution > 0.3)
//   • A previously unseen entity appeared in the thread
//   • A provocative reply arrived when heat is already elevated (> 0.3)
//   • The user gave explicit feedback on a reply (always meaningful)

import type {
  InterpolatorState,
  InterpolatorTrigger,
  InterpolatorTriggerKind,
  ContributionScore,
} from './interpolatorTypes';
import { computeThreadChangeDelta, type ThreadStateSnapshot } from './algorithms';

// ─── Thread snapshot tracking ────────────────────────────────────────────
// Cache to store previous snapshots per thread URI for change detection
const threadSnapshotCache = new Map<string, { snapshot: ThreadStateSnapshot; timestamp: number }>();

// ─── helpers ─────────────────────────────────────────────────────────────

function makeTrigger(
  kind: InterpolatorTriggerKind,
  replyUri?: string,
  payload?: unknown,
): InterpolatorTrigger {
  return {
    kind,
    ...(replyUri !== undefined ? { replyUri } : {}),
    ...(payload !== undefined ? { payload } : {}),
    triggeredAt: new Date().toISOString(),
  };
}

function buildThreadStateSnapshot(
  threadUri: string,
  state: InterpolatorState,
): ThreadStateSnapshot {
  const contributorRoles = new Map<string, number>();
  for (const contributor of state.topContributors.slice(0, 5)) {
    contributorRoles.set(
      contributor.dominantRole,
      (contributorRoles.get(contributor.dominantRole) ?? 0) + 1,
    );
  }

  const dominantStance = [...contributorRoles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  const replyScoreList = Object.values(state.replyScores);
  const sourceBackedClarity = replyScoreList.length > 0
    ? replyScoreList.reduce((sum, score) => sum + (score.factualContribution ?? 0), 0) / replyScoreList.length
    : 0;

  const replyCount = replyScoreList.length;
  const maturity: ThreadStateSnapshot['threadMaturity'] =
    replyCount < 5 ? 'forming' : replyCount < 20 ? 'developing' : 'settled';

  const topEntityIds = [...state.entityLandscape]
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 5)
    .map((entity) => entity.canonicalEntityId ?? entity.entityText.toLowerCase());

  const averageContributorImpact = state.topContributors.length > 0
    ? state.topContributors.reduce((sum, contributor) => sum + contributor.avgUsefulnessScore, 0) / state.topContributors.length
    : 0;

  return {
    timestamp: new Date().toISOString(),
    threadUri,
    rootAuthorDid: state.topContributors[0]?.did ?? 'unknown',
    replyCount,
    topContributorDids: state.topContributors.slice(0, 5).map((contributor) => contributor.did),
    dominantStance,
    minorityStancesPresent: contributorRoles.size > 1,
    hasFactualContent: state.factualSignalPresent,
    sourceBackedClarity,
    heat: Math.max(0, Math.min(1, state.heatLevel)),
    threadMaturity: maturity,
    topEntityIds,
    entityCount: state.entityLandscape.length,
    overallConfidence: Math.max(0, Math.min(1, averageContributorImpact)),
  };
}

export function recordThreadSnapshot(
  threadUri: string,
  state: InterpolatorState,
): void {
  threadSnapshotCache.set(threadUri, {
    snapshot: buildThreadStateSnapshot(threadUri, state),
    timestamp: Date.now(),
  });
}

// ─── detectTrigger ────────────────────────────────────────────────────────
// Returns a trigger if an update is warranted, or null to skip.

export function detectTrigger(
  existingState: InterpolatorState | null,
  newScores: Record<string, ContributionScore>,
  newRepliesCount: number,
  userFeedbackReplyUri?: string,
): InterpolatorTrigger | null {
  // First open: always trigger
  if (!existingState || existingState.version === 0) {
    return makeTrigger('new_replies', undefined, { count: newRepliesCount, initial: true });
  }

  // User feedback is always meaningful
  if (userFeedbackReplyUri) {
    return makeTrigger('user_feedback', userFeedbackReplyUri);
  }

  // Enough new replies to justify a summary refresh
  if (newRepliesCount >= 3) {
    return makeTrigger('new_replies', undefined, { count: newRepliesCount });
  }

  for (const score of Object.values(newScores)) {
    // Strong evidence signal
    if (score.factualContribution > 0.3) {
      return makeTrigger('high_evidence', score.uri, {
        factualContribution: score.factualContribution,
      });
    }

    // New entity discovered
    const newEntity = score.entityImpacts.find(e => e.isNewEntity);
    if (newEntity) {
      return makeTrigger('new_entity', score.uri, { entity: newEntity.entityText });
    }

    // Heat spike: provocative reply when thread is already warm
    if (score.role === 'provocative' && existingState.heatLevel > 0.3) {
      return makeTrigger('heat_spike', score.uri, {
        currentHeat: existingState.heatLevel,
      });
    }
  }

  return null;
}

// ─── applyTriggerToState ──────────────────────────────────────────────────
// Merges a summary patch and trigger into an existing InterpolatorState,
// returning the new state. Caller is responsible for persisting it.

export function applyTriggerToState(
  existing: InterpolatorState,
  patch: Partial<Omit<InterpolatorState, 'rootUri' | 'version' | 'updatedAt'>>,
  trigger: InterpolatorTrigger,
): InterpolatorState {
  const triggerHistory = [...existing.triggerHistory, trigger].slice(-20);
  return {
    ...existing,
    ...patch,
    // Merge reply scores rather than replacing so userFeedback on old replies is preserved
    replyScores: { ...existing.replyScores, ...(patch.replyScores ?? {}) },
    lastTrigger: trigger,
    triggerHistory,
    updatedAt: new Date().toISOString(),
    version: existing.version + 1,
  };
}

// ─── Enhanced change detection with algorithm layer ─────────────────────────

/**
 * Detect meaningful thread changes using heuristic signals.
 * Enhanced version with rate limiting and change confidence tracking.
 *
 * Returns { shouldUpdate, confidence, reasons } for informed decision making.
 */
export function detectMeaningfulChange(
  threadUri: string,
  currentState: InterpolatorState,
  newRepliesCount: number,
  rateLimitThreshold: number = 30000, // 30 seconds
): { shouldUpdate: boolean; confidence: number; reasons: string[] } {
  try {
    // Check rate limiting first
    const cached = threadSnapshotCache.get(threadUri);
    const now = Date.now();

    if (cached && (now - cached.timestamp < rateLimitThreshold)) {
      return { shouldUpdate: false, confidence: 0, reasons: ['rate_limited'] };
    }

    const currentSnapshot = buildThreadStateSnapshot(threadUri, currentState);
    const delta = computeThreadChangeDelta(cached?.snapshot ?? null, currentSnapshot, {
      minChangeThreshold: 0.4,
      minHeatLevel: 0.25,
    });

    const reasons = [...delta.changeReasons];
    if (newRepliesCount >= 3 && !reasons.includes('thread_maturity_change')) {
      reasons.push('thread_maturity_change');
    }

    const shouldUpdate = delta.shouldUpdate || (cached == null && newRepliesCount > 0);
    const confidence = Math.max(delta.confidence, Math.min(1, newRepliesCount / 6));

    return {
      shouldUpdate,
      confidence,
      reasons: reasons.slice(0, 3), // Top 3 reasons
    };
  } catch (err) {
    console.error('[detectMeaningfulChange] Error during change detection');
    // Graceful fallback: allow update if algorithm fails
    return { shouldUpdate: true, confidence: 0.5, reasons: ['fallback_heuristic'] };
  }
}

/**
 * Clear cached snapshots for a thread (useful for testing or memory cleanup).
 */
export function clearThreadSnapshot(threadUri: string): void {
  threadSnapshotCache.delete(threadUri);
}

/**
 * Get cached snapshot info (for debugging or monitoring).
 */
export function getThreadSnapshotInfo(threadUri: string): { age: number; exists: boolean } | null {
  const cached = threadSnapshotCache.get(threadUri);
  if (!cached) return null;
  return {
    exists: true,
    age: Date.now() - cached.timestamp,
  };
}
