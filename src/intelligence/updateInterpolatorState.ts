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
