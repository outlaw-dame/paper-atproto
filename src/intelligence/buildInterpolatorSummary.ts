// ─── Build Interpolator Summary ───────────────────────────────────────────
// Produces a rich InterpolatorState patch from a set of scored replies.
// Replaces the legacy buildRollingSummary in threadStore.
//
// Outputs all derived fields of InterpolatorState except the identity
// fields (rootUri, version, updatedAt, replyScores, trigger history)
// which are applied by updateInterpolatorState.ts.

import type {
  InterpolatorState,
  ContributionScore,
  EntityImpact,
} from './interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
import { computeContributorImpacts } from './scoreThread.js';

type SummaryPatch = Omit<
  InterpolatorState,
  'rootUri' | 'version' | 'updatedAt' | 'replyScores' | 'lastTrigger' | 'triggerHistory'
>;

export function buildInterpolatorSummary(
  rootText: string,
  replies: ThreadNode[],
  scores: Record<string, ContributionScore>,
): SummaryPatch {
  const salientClaims: string[] = [rootText.slice(0, 120)];
  const salientContributors: string[] = [];
  const clarificationsAdded: string[] = [];
  const newAnglesAdded: string[] = [];
  let repetitionLevel = 0;
  let heatLevel = 0;
  let sourceSupportPresent = false;
  let evidencePresent = false;
  let factualSignalPresent = false;

  // Build entity landscape: merge entity impacts across all replies, dedup by text
  const entityMap = new Map<string, EntityImpact>();

  // Sort descending by usefulness so the most valuable replies shape the summary
  const sorted = [...replies].sort(
    (a, b) => (scores[b.uri]?.usefulnessScore ?? 0) - (scores[a.uri]?.usefulnessScore ?? 0)
  );

  for (const reply of sorted) {
    const score = scores[reply.uri];
    if (!score) continue;

    // Merge entity impacts
    for (const ei of score.entityImpacts) {
      const key = ei.entityText.toLowerCase();
      if (entityMap.has(key)) {
        const prev = entityMap.get(key)!;
        entityMap.set(key, { ...prev, mentionCount: prev.mentionCount + ei.mentionCount });
      } else {
        entityMap.set(key, { ...ei });
      }
    }

    if (score.evidenceSignals.some(s => s.kind !== 'speculation')) evidencePresent = true;
    if (score.factualContribution > 0.3) factualSignalPresent = true;

    if (score.role === 'repetitive') {
      repetitionLevel = Math.min(1, repetitionLevel + 0.12);
      continue;  // repetitive replies don't feed salient content
    }

    if (score.role === 'provocative') {
      heatLevel = Math.min(1, heatLevel + 0.18);
    }

    if (score.role === 'clarifying') {
      clarificationsAdded.push(reply.text.slice(0, 80));
    }

    if (
      score.role === 'new_information' ||
      score.role === 'useful_counterpoint' ||
      score.role === 'story_worthy'
    ) {
      newAnglesAdded.push(reply.text.slice(0, 80));
    }

    if (
      reply.embed?.kind === 'external' ||
      score.evidenceSignals.some(s => s.kind === 'citation')
    ) {
      sourceSupportPresent = true;
    }

    if (score.usefulnessScore > 0.55 && reply.authorDid &&
        !salientContributors.includes(reply.authorDid)) {
      salientContributors.push(reply.authorDid);
    }

    if (score.usefulnessScore > 0.65) {
      salientClaims.push(reply.text.slice(0, 100));
    }
  }

  const topContributors = computeContributorImpacts(replies, scores);

  const entityLandscape = [...entityMap.values()]
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 15);

  // Build human-readable summary sentence
  const parts: string[] = [];
  if (clarificationsAdded.length > 0)
    parts.push(`${clarificationsAdded.length} clarification${clarificationsAdded.length > 1 ? 's' : ''} added`);
  if (newAnglesAdded.length > 0)
    parts.push(`${newAnglesAdded.length} new angle${newAnglesAdded.length > 1 ? 's' : ''} introduced`);
  if (sourceSupportPresent) parts.push('sources cited');
  if (factualSignalPresent) parts.push('factual contributions present');
  if (heatLevel > 0.4) parts.push('some heat in the thread');

  const summaryText = parts.length > 0
    ? `This discussion has ${parts.join(', ')}.`
    : 'Discussion is still developing.';

  return {
    summaryText,
    salientClaims,
    salientContributors,
    clarificationsAdded,
    newAnglesAdded,
    repetitionLevel,
    heatLevel,
    sourceSupportPresent,
    entityLandscape,
    topContributors,
    evidencePresent,
    factualSignalPresent,
  };
}
