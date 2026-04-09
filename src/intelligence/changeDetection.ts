// ─── Meaningful Thread-Change Detection ──────────────────────────────────────
// Computes whether the thread changed meaningfully enough to justify
// rewriting the visible Interpolator state.
//
// Replaces the simple version/reply-count check in threadPipeline.ts with a
// structured multi-signal analysis.
//
// change_magnitude =
//   0.25 * new_angle_delta
// + 0.20 * contributor_shift
// + 0.15 * entity_shift
// + 0.15 * factual_shift
// + 0.15 * heat_delta
// + 0.10 * repetition_delta

import type {
  ThreadInterpolatorState,
  InterpolatorDecisionScore,
  AtUri,
} from './interpolatorTypes';
import { computeThreadChangeDelta, type ThreadStateSnapshot } from './algorithms';

// ─── Change reason types ──────────────────────────────────────────────────

export type ChangeReason =
  | 'new_stance_appeared'
  | 'source_backed_clarification'
  | 'major_contributor_entered'
  | 'heat_shift'
  | 'central_entity_changed'
  | 'new_angle_introduced'
  | 'factual_highlight_added'
  | 'thread_direction_reversed';

export interface ThreadChangeResult {
  didMeaningfullyChange: boolean;
  changeMagnitude: number;
  changeReasons: ChangeReason[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─── computeThreadChange ──────────────────────────────────────────────────

/**
 * Determines whether the thread changed meaningfully enough to justify a
 * visible Interpolator update. Returns `didMeaningfullyChange`, a
 * `changeMagnitude` (0–1), and structured `changeReasons`.
 *
 * Intended to replace the simple `version > previous.version || candidates.length > 0`
 * check in threadPipeline.ts with a semantically-grounded decision.
 */
export function computeThreadChange(
  previous: ThreadInterpolatorState | null,
  current: ThreadInterpolatorState,
  scores: Record<AtUri, InterpolatorDecisionScore>,
): ThreadChangeResult {
  const toSnapshot = (state: ThreadInterpolatorState): ThreadStateSnapshot => {
    const topEntityIds = [...state.entityLandscape]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 5)
      .map((entity) => entity.canonicalEntityId ?? entity.entityText.toLowerCase());

    const topRoles = state.topContributors
      .slice(0, 5)
      .map((contributor) => contributor.dominantRole);
    const roleHistogram = new Map<string, number>();
    for (const role of topRoles) {
      roleHistogram.set(role, (roleHistogram.get(role) ?? 0) + 1);
    }

    const replyScores = Object.values(state.replyScores);
    const sourceBackedClarity = replyScores.length > 0
      ? replyScores.reduce((sum, score) => sum + (score.factualContribution ?? 0), 0) / replyScores.length
      : 0;

    const overallConfidence = state.topContributors.length > 0
      ? state.topContributors.reduce((sum, contributor) => sum + contributor.avgUsefulnessScore, 0) / state.topContributors.length
      : 0.5;

    const replyCount = Object.keys(state.replyScores).length;
    const threadMaturity: ThreadStateSnapshot['threadMaturity'] =
      replyCount < 5 ? 'forming' : replyCount < 20 ? 'developing' : 'settled';

    return {
      timestamp: state.updatedAt,
      threadUri: state.rootUri,
      rootAuthorDid: state.topContributors[0]?.did ?? 'unknown',
      replyCount,
      topContributorDids: state.topContributors.slice(0, 5).map((contributor) => contributor.did),
      dominantStance: [...roleHistogram.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown',
      minorityStancesPresent: roleHistogram.size > 1,
      hasFactualContent: state.factualSignalPresent,
      sourceBackedClarity: clamp(sourceBackedClarity),
      heat: clamp(state.heatLevel),
      threadMaturity,
      topEntityIds,
      entityCount: state.entityLandscape.length,
      overallConfidence: clamp(overallConfidence),
    };
  };

  if (previous === null || previous.version === 0) {
    return {
      didMeaningfullyChange: true,
      changeMagnitude: 1,
      changeReasons: ['new_angle_introduced'],
    };
  }

  const previousSnapshot = toSnapshot(previous);
  const currentSnapshot = toSnapshot(current);
  const delta = computeThreadChangeDelta(previousSnapshot, currentSnapshot, {
    minChangeThreshold: 0.2,
    minHeatLevel: 0.15,
  });

  const reasonMap: Partial<Record<string, ChangeReason>> = {
    new_stance_entered: 'new_stance_appeared',
    source_backed_clarification: 'source_backed_clarification',
    major_contributor_shift: 'major_contributor_entered',
    heat_escalation: 'heat_shift',
    entity_focus_shift: 'central_entity_changed',
    thread_maturity_change: 'new_angle_introduced',
    factual_clarity_increased: 'factual_highlight_added',
    repetition_detected: 'thread_direction_reversed',
  };

  const changeReasons = delta.changeReasons
    .map((reason) => reasonMap[reason])
    .filter((reason): reason is ChangeReason => reason !== undefined);

  return {
    didMeaningfullyChange: delta.shouldUpdate || changeReasons.length > 0,
    changeMagnitude: delta.changeMagnitude,
    changeReasons,
  };
}
