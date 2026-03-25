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

// ─── synthesiseSummary ────────────────────────────────────────────────────
// Builds a single cohesive prose sentence that explains what the thread is
// about, who is shaping it, and how grounded or contested it is.
// No templates — character is derived from structured signals.

function topicPhrase(rootText: string): string {
  const clean = rootText.replace(/\s+/g, ' ').trim();
  const sentEnd = clean.search(/[.!?\n]/);
  const base = sentEnd > 15 && sentEnd < 140 ? clean.slice(0, sentEnd) : clean.slice(0, 100);
  if (base.length < clean.length && base.length <= 90) return base + '…';
  if (base.length > 90) {
    const cut = base.slice(0, 90);
    const lastSpace = cut.lastIndexOf(' ');
    return lastSpace > 55 ? cut.slice(0, lastSpace) + '…' : cut + '…';
  }
  return base;
}

function synthesiseSummary(
  rootText: string,
  entityLandscape: EntityImpact[],
  topContributors: ReturnType<typeof import('./scoreThread.js').computeContributorImpacts>,
  clarificationsAdded: string[],
  newAnglesAdded: string[],
  sourceSupportPresent: boolean,
  factualSignalPresent: boolean,
  heatLevel: number,
  repetitionLevel: number,
  totalReplies: number,
  topEntitySentiment: number,
): string {
  if (totalReplies === 0) return '';

  const topEntities = entityLandscape.slice(0, 2).map(e => e.entityText);
  const namedVoice = topContributors.find(c => c.handle != null);
  const isHot = heatLevel > 0.45;
  const isRepetitive = repetitionLevel > 0.40;
  const isGrounded = factualSignalPresent || sourceSupportPresent;
  const hasClarifications = clarificationsAdded.length > 0;
  const hasNewAngles = newAnglesAdded.length > 0;

  // Opening: what the thread is about
  let opening: string;
  if (topEntities.length >= 2) {
    opening = `The thread centres on ${topEntities[0]} and ${topEntities[1]}`;
  } else if (topEntities.length === 1) {
    opening = `The discussion focuses on ${topEntities[0]}`;
  } else {
    opening = `The thread is focused on "${topicPhrase(rootText)}"`;
  }

  // Middle: dominant discussion character
  let middle: string;
  if (isHot && !isGrounded) {
    middle = 'and has generated heat without much sourcing to anchor it';
  } else if (isHot && isGrounded) {
    middle = 'with heated takes and source-backed grounding both in play';
  } else if (isGrounded && hasClarifications) {
    middle = 'with contributors adding clarification backed by cited sources';
  } else if (isGrounded && hasNewAngles) {
    middle = 'with fresh angles entering and evidence grounding the conversation';
  } else if (hasClarifications && hasNewAngles) {
    middle = 'with both clarifications and new perspectives shaping the conversation';
  } else if (hasClarifications) {
    middle = 'with contributors focused on clarifying the key points';
  } else if (hasNewAngles) {
    middle = `with ${newAnglesAdded.length} new angle${newAnglesAdded.length > 1 ? 's' : ''} introduced so far`;
  } else if (isRepetitive) {
    middle = 'though much of the conversation is covering the same ground';
  } else {
    middle = 'and is still developing';
  }

  // Coda: name a key voice and their role
  const roleDesc: Record<string, string> = {
    clarifying: 'clarifying the key points',
    new_information: 'bringing new information',
    useful_counterpoint: 'offering a counterpoint',
    source_bringer: 'citing primary sources',
    rule_source: 'grounding the discussion in official sources',
    story_worthy: 'shaping the narrative',
    direct_response: 'responding directly',
    repetitive: 'echoing earlier points',
    provocative: 'raising the temperature',
    unknown: 'contributing',
  };

  let coda = '';
  if (namedVoice?.handle != null) {
    const desc = roleDesc[namedVoice.dominantRole] ?? 'contributing';
    coda = ` @${namedVoice.handle} is ${desc}.`;
  }

  // Sentiment assist: only surfaces when strongly skewed and not already captured by heat
  const topEntity = entityLandscape[0];
  if (!isHot && topEntity !== undefined && Math.abs(topEntitySentiment) > 0.45) {
    const direction = topEntitySentiment < 0 ? 'critical' : 'positive';
    const sentimentNote = ` The tone toward ${topEntity.entityText} is running ${direction}.`;
    coda += sentimentNote;
  }

  return `${opening}, ${middle}.${coda}`;
}

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

    // Merge entity impacts; maintain a mention-count-weighted average of sentimentShift
    for (const ei of score.entityImpacts) {
      const key = ei.entityText.toLowerCase();
      if (entityMap.has(key)) {
        const prev = entityMap.get(key)!;
        const totalMentions = prev.mentionCount + ei.mentionCount;
        const avgSentiment = totalMentions > 0
          ? (prev.sentimentShift * prev.mentionCount + ei.sentimentShift * ei.mentionCount) / totalMentions
          : 0;
        entityMap.set(key, {
          ...prev,
          mentionCount: totalMentions,
          sentimentShift: Math.max(-1, Math.min(1, avgSentiment)),
        });
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

  const topEntitySentiment = entityLandscape[0]?.sentimentShift ?? 0;

  const summaryText = synthesiseSummary(
    rootText,
    entityLandscape,
    topContributors,
    clarificationsAdded,
    newAnglesAdded,
    sourceSupportPresent,
    factualSignalPresent,
    heatLevel,
    repetitionLevel,
    sorted.length,
    topEntitySentiment,
  );

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
