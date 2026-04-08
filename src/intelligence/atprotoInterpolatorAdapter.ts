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

import type { InterpolatorState, InterpolatorInput, ThreadPost, ThreadMediaItem } from './interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import { scoreAllReplies } from './scoreThread';
import { buildInterpolatorSummary } from './buildInterpolatorSummary';
import {
  detectTrigger,
  applyTriggerToState,
  detectMeaningfulChange,
  recordThreadSnapshot,
} from './updateInterpolatorState';

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
  const existingReplyUris = new Set(Object.keys(existingState?.replyScores ?? {}));

  // Step 1: Score all replies
  const newScores = scoreAllReplies(rootText, replies);
  const triggerScores = Object.fromEntries(
    Object.entries(newScores).filter(([uri]) => !existingReplyUris.has(uri)),
  );
  const newRepliesCount = Object.keys(triggerScores).length;

  // Step 2: Build a candidate patch and use it to evaluate whether the thread
  // actually changed enough to justify a visible update.
  const summaryPatch = buildInterpolatorSummary(rootText, replies, newScores);

  if (existingState && existingState.version > 0) {
    const candidateState: InterpolatorState = {
      ...existingState,
      ...summaryPatch,
      replyScores: { ...existingState.replyScores, ...newScores },
    };
    const changeDecision = detectMeaningfulChange(rootUri, candidateState, newRepliesCount);
    const trigger = detectTrigger(existingState, triggerScores, newRepliesCount);

    // The change detector rate-limits routine refreshes, but a strong trigger
    // (high evidence, new entity, enough new replies) should still advance the
    // visible state immediately.
    if (!changeDecision.shouldUpdate && !trigger) {
      return existingState;
    }

    const activeTrigger = trigger ?? {
      kind: 'new_replies' as const,
      payload: {
        count: newRepliesCount,
        confidence: changeDecision.confidence,
        reasons: changeDecision.reasons,
      },
      triggeredAt: new Date().toISOString(),
    };

    const nextState = applyTriggerToState(base, { ...summaryPatch, replyScores: newScores }, activeTrigger);
    recordThreadSnapshot(rootUri, nextState);
    return nextState;
  }

  // Step 3: Detect trigger
  const trigger = detectTrigger(existingState ?? null, triggerScores, newRepliesCount);

  // Short-circuit: no meaningful change detected
  if (!trigger && existingState && existingState.version > 0) {
    return existingState;
  }

  // Step 4: Apply trigger (create a default 'new_replies' trigger if detectTrigger
  //         returned null but we had no existing state — first-run path)
  const activeTrigger = trigger ?? {
    kind: 'new_replies' as const,
    payload: { count: newRepliesCount, initial: true },
    triggeredAt: new Date().toISOString(),
  };

  const nextState = applyTriggerToState(base, { ...summaryPatch, replyScores: newScores }, activeTrigger);
  recordThreadSnapshot(rootUri, nextState);
  return nextState;
}

// ─── Phase 3: ATProto → ThreadPost adapter ────────────────────────────────

/**
 * Extracts image media from a resolved ThreadNode embed.
 * Handles both 'images' and 'recordWithMedia' embed kinds.
 */
export function extractMedia(node: ThreadNode): ThreadPost['media'] {
  const media: NonNullable<ThreadPost['media']> = [];

  if (node.embed?.kind === 'images' && node.embed.images?.length) {
    for (const image of node.embed.images) {
      media.push({
        url: image.url,
        ...(image.alt ? { alt: image.alt } : {}),
        ...(image.aspectRatio?.width !== undefined ? { width: image.aspectRatio.width } : {}),
        ...(image.aspectRatio?.height !== undefined ? { height: image.aspectRatio.height } : {}),
      });
    }
  }

  if (node.embed?.kind === 'recordWithMedia' && node.embed.mediaImages?.length) {
    for (const image of node.embed.mediaImages) {
      media.push({
        url: image.url,
        ...(image.alt ? { alt: image.alt } : {}),
      });
    }
  }

  return media.length > 0 ? media : undefined;
}

/**
 * Converts a resolved ATProto ThreadNode into a ThreadPost suitable for
 * the Phase 3 verification pipeline.
 */
export function nodeToThreadPost(node: ThreadNode): ThreadPost {
  const media = extractMedia(node);

  const embeds: NonNullable<ThreadPost['embeds']> = [];
  if (node.embed?.kind === 'external' && node.embed.external) {
    const ext = node.embed.external;
    embeds.push({
      url: ext.uri,
      ...(ext.domain !== undefined ? { domain: ext.domain } : {}),
      ...(ext.title !== undefined ? { title: ext.title } : {}),
      ...(ext.description !== undefined ? { description: ext.description } : {}),
    });
  }

  const facets: NonNullable<ThreadPost['facets']> = node.facets
    .filter(f => f.kind === 'link' || f.kind === 'mention' || f.kind === 'hashtag')
    .map(f => ({
      type: (f.kind === 'hashtag' ? 'tag' : f.kind) as 'link' | 'mention' | 'tag',
      // ResolvedFacet has no raw text — derive a usable label from available fields
      text: f.kind === 'link' ? (f.domain ?? f.uri ?? '') : f.kind === 'mention' ? (f.did ?? '') : '',
      ...(f.uri !== undefined ? { uri: f.uri } : {}),
    }));

  return {
    uri: node.uri,
    did: node.authorDid ?? '',
    ...(node.authorHandle !== undefined ? { handle: node.authorHandle } : {}),
    ...(node.authorName !== undefined ? { displayName: node.authorName } : {}),
    text: node.text ?? '',
    ...(node.createdAt !== undefined ? { indexedAt: node.createdAt } : {}),
    likeCount: node.likeCount,
    replyCount: node.replyCount,
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(media !== undefined ? { media } : {}),
    ...(facets.length > 0 ? { facets } : {}),
  };
}
