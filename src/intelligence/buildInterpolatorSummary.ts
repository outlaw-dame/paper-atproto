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
} from './interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import { computeContributorImpacts } from './scoreThread';

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

function compactTopicPhrase(value: string, maxLen = 64): string {
  if (value.length <= maxLen) return value;
  const sliced = value.slice(0, maxLen).trimEnd();
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= Math.max(20, Math.floor(maxLen * 0.5))) {
    return `${sliced.slice(0, lastSpace).trimEnd()}...`;
  }
  return `${sliced}...`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function joinReplyClauses(clauses: string[]): string {
  if (clauses.length === 0) return 'remain mixed and early';
  if (clauses.length === 1) return clauses[0]!;
  if (clauses.length === 2) return `${clauses[0]!} and ${clauses[1]!}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]!}`;
}

function synthesiseSummary(
  rootText: string,
  entityLandscape: EntityImpact[],
  _topContributors: ReturnType<typeof import('./scoreThread').computeContributorImpacts>,
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

  const isHot = heatLevel > 0.45;
  const isRepetitive = repetitionLevel > 0.40;
  const isGrounded = factualSignalPresent || sourceSupportPresent;
  const hasClarifications = clarificationsAdded.length > 0;
  const hasNewAngles = newAnglesAdded.length > 0;
  const opening = ensureSentence(topicPhrase(rootText));

  const replyClauses: string[] = [];
  if (hasClarifications) replyClauses.push('add clarification');
  if (hasNewAngles) replyClauses.push('introduce counterpoints and new context');
  if (isGrounded) replyClauses.push('keep returning to cited material');

  if (replyClauses.length === 0 && isHot && !isGrounded) {
    replyClauses.push('turn heated quickly');
  }
  if (replyClauses.length === 0 && isRepetitive) {
    replyClauses.push('repeat the same point');
  }

  const middle = `Replies ${joinReplyClauses(replyClauses.slice(0, 3))}.`;

  let coda = '';
  if (isHot && !isGrounded) {
    coda = 'Source support remains thin.';
  } else if (isHot && isGrounded) {
    coda = 'The dispute is heated, but cited material is keeping the thread anchored.';
  } else if (isRepetitive && !hasClarifications && !hasNewAngles) {
    coda = 'A lot of the thread is still circling the same point.';
  } else if (!isHot && entityLandscape[0] !== undefined && Math.abs(topEntitySentiment) > 0.45) {
    const direction = topEntitySentiment < 0 ? 'critical' : 'positive';
    coda = `The tone toward ${entityLandscape[0].entityText} is running ${direction}.`;
  }

  return `${opening} ${middle}${coda ? ` ${coda}` : ''}`.trim();
}

function buildPerspectiveGaps(params: {
  rootText: string;
  replies: ThreadNode[];
  scores: Record<string, ContributionScore>;
  clarificationsAdded: string[];
  newAnglesAdded: string[];
  sourceSupportPresent: boolean;
  factualSignalPresent: boolean;
}): string[] {
  const {
    rootText,
    replies,
    scores,
    clarificationsAdded,
    newAnglesAdded,
    sourceSupportPresent,
    factualSignalPresent,
  } = params;

  if (replies.length === 0) return [];

  const gaps: string[] = [];
  const focus = compactTopicPhrase(topicPhrase(rootText).replace(/[.!?…]+$/g, '').trim(), 64);
  const focusPhrase = focus ? `"${focus}"` : 'the main claim';
  const participantCount = new Set(
    replies
      .map((reply) => reply.authorDid || reply.authorHandle)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ).size;
  const hasCounterpoint = replies.some((reply) => scores[reply.uri]?.role === 'useful_counterpoint');
  const hasOfficialSource = replies.some((reply) => scores[reply.uri]?.role === 'rule_source');
  const hasSecondarySourceMention = replies.some((reply) => {
    const lower = reply.text.toLowerCase();
    return /\b(blog post|writeup|article|thread)\b/.test(lower);
  });

  if (!sourceSupportPresent && !factualSignalPresent) {
    gaps.push(`The visible thread still lacks direct sourcing or verifiable evidence for ${focusPhrase}.`);
  } else if (!hasOfficialSource && hasSecondarySourceMention) {
    gaps.push(`Visible replies cite secondary context around ${focusPhrase}, but direct sourcing or verifiable evidence is still missing.`);
  }

  if (replies.length >= 2 && !hasCounterpoint) {
    gaps.push(`There is little visible counterpoint to the main read of ${focusPhrase} so far.`);
  }

  if (replies.length >= 2 && participantCount <= 1) {
    gaps.push(`${focusPhrase} is being shaped by a narrow slice of participants so far.`);
  }

  if (replies.length >= 2 && clarificationsAdded.length === 0 && newAnglesAdded.length === 0) {
    gaps.push(`Visible replies have not materially moved the thread beyond the initial claim in ${focusPhrase}.`);
  }

  return Array.from(new Set(gaps)).slice(0, 3);
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
    const hasSourceLikeSignal = score.role === 'source_bringer'
      || score.role === 'rule_source'
      || score.evidenceSignals.some(s => s.kind === 'citation' && s.confidence >= 0.6);
    if (score.factualContribution > 0.3 || hasSourceLikeSignal) factualSignalPresent = true;

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
  const perspectiveGaps = buildPerspectiveGaps({
    rootText,
    replies: sorted,
    scores,
    clarificationsAdded,
    newAnglesAdded,
    sourceSupportPresent,
    factualSignalPresent,
  });

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
    perspectiveGaps,
    entityLandscape,
    topContributors,
    evidencePresent,
    factualSignalPresent,
  };
}
