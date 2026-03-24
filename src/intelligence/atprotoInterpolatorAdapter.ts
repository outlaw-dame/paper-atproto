// ─── ATProto Interpolator Adapter ─────────────────────────────────────────
// Bridges resolved ATProto thread data to the full Interpolator pipeline.
//
// Entry point: runInterpolatorPipeline()
//
// Pipeline steps:
//   1. Score all replies via scoreAllReplies (entity-aware, evidence-aware)
//   2. Detect whether a meaningful trigger warrants a state update
//   3. Build a rich summary patch via buildInterpolatorSummary
//   4. Apply the trigger and patch to produce a new InterpolatorState
//
// Returns:
//   • The updated InterpolatorState (always — caller persists via store)
//   • If no trigger is detected and an existing non-empty state is present,
//     the existing state is returned unchanged (cheap short-circuit)
//
// This module does NOT make network calls. Retry logic for the ATProto
// fetch that feeds this pipeline lives in retry.ts and is the caller's
// responsibility (see StoryMode.tsx).

import type { InterpolatorState, InterpolatorInput } from './interpolatorTypes.js';
import { scoreAllReplies } from './scoreThread.js';
import { buildInterpolatorSummary } from './buildInterpolatorSummary.js';
import { detectTrigger, applyTriggerToState } from './updateInterpolatorState.js';

// ─── emptyInterpolatorState ───────────────────────────────────────────────

export function emptyInterpolatorState(rootUri: string): InterpolatorState {
  return {
    rootUri,
    summaryText: '',
    salientClaims: [],
    salientContributors: [],
    clarificationsAdded: [],
    newAnglesAdded: [],
    repetitionLevel: 0,
    heatLevel: 0,
    sourceSupportPresent: false,
    replyScores: {},
    entityLandscape: [],
    topContributors: [],
    evidencePresent: false,
    factualSignalPresent: false,
    lastTrigger: null,
    triggerHistory: [],
    updatedAt: new Date().toISOString(),
    version: 0,
  };
}

// ─── runInterpolatorPipeline ──────────────────────────────────────────────

export function runInterpolatorPipeline(input: InterpolatorInput): InterpolatorState {
  const { rootUri, rootText, replies, existingState } = input;
  const base = existingState ?? emptyInterpolatorState(rootUri);

  // Step 1: Score all replies
  const newScores = scoreAllReplies(rootText, replies);

  // Step 2: Detect trigger
  const trigger = detectTrigger(existingState ?? null, newScores, replies.length);

  // Short-circuit: no meaningful change detected
  if (!trigger && existingState && existingState.version > 0) {
    return existingState;
  }

  // Step 3: Build summary patch
  const summaryPatch = buildInterpolatorSummary(rootText, replies, newScores);

  // Step 4: Apply trigger (create a default 'new_replies' trigger if detectTrigger
  //         returned null but we had no existing state — first-run path)
  const activeTrigger = trigger ?? {
    kind: 'new_replies' as const,
    payload: { count: replies.length, initial: true },
    triggeredAt: new Date().toISOString(),
  };

  return applyTriggerToState(base, { ...summaryPatch, replyScores: newScores }, activeTrigger);
}
