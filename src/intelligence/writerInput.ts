// ─── Writer Input Builder — Narwhal v3 ────────────────────────────────────
// Constructs ThreadStateForWriter from the pipeline state.
// Applies inclusion thresholds, selects top comments, maps entities/contributors.
// Called after confidence computation, before calling the model client.

import type {
  ThreadStateForWriter,
  WriterComment,
  WriterContributor,
  WriterEntity,
  WriterMediaFinding,
  WriterThreadSignalSummary,
  ConfidenceState,
  SummaryMode,
} from './llmContracts';
import type { InterpolatorState, ContributionScores, ContributionRole } from './interpolatorTypes';
import type { ThreadNode } from '../lib/resolver/atproto';
import {
  chooseSummaryMode,
  entityMayBeNamed,
} from './routing';
import { selectContributors } from './contributorSelection';
import { selectDiverseComments } from './redundancy';
import {
  selectContributorsAlgorithmic,
  compareSelectionApproaches,
  computeEntityCentralityScores,
  buildEntityCentralityResult,
  getTopCentralEntities,
  clusterStanceCoverage,
  filterByStanceDiversity,
  type EntityInfo,
} from './algorithms';

// ─── Writer Input Diagnostics ─────────────────────────────────────────────
// Tracks algorithmic contributor selection failures so callers can surface
// fallback rates without relying solely on console.error scanning.

type WriterInputTelemetry = {
  algorithmicSelectionFallbacks: number;
  stanceFallbacks: number;
};

const _writerInputTelemetry: WriterInputTelemetry = {
  algorithmicSelectionFallbacks: 0,
  stanceFallbacks: 0,
};

export function getWriterInputTelemetry(): WriterInputTelemetry {
  return { ..._writerInputTelemetry };
}

function toSafeErrorMeta(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 180),
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown writer-input algorithm error',
  };
}

export type WriterTranslationMap = Record<string, {
  translatedText?: string;
  sourceLang?: string;
}>;

// ─── Entity kind → writer type ────────────────────────────────────────────
const ENTITY_TYPE_MAP: Record<string, WriterEntity['type']> = {
  person: 'person',
  org: 'organization',
  place: 'topic',
  concept: 'topic',
  claim: 'topic',
};

// ─── Role → writer role ───────────────────────────────────────────────────
function mapRole(role: ContributionRole): WriterContributor['role'] {
  const map: Partial<Record<ContributionRole, WriterContributor['role']>> = {
    clarifying: 'clarifier',
    source_bringer: 'source-bringer',
    rule_source: 'rule-source',
    useful_counterpoint: 'counterpoint',
    new_information: 'context-setter',
    direct_response: 'context-setter',
    story_worthy: 'context-setter',
    provocative: 'emotional-reaction',
  };
  return map[role] ?? 'context-setter';
}

function mapRoleToStance(role: ContributionRole): string {
  const map: Partial<Record<ContributionRole, string>> = {
    clarifying: 'clarifying the key points',
    source_bringer: 'bringing primary sources',
    rule_source: 'citing official sources',
    useful_counterpoint: 'offering a well-reasoned counterpoint',
    new_information: 'introducing new information',
    direct_response: 'responding directly to the original post',
    story_worthy: 'shaping the narrative direction',
    provocative: 'raising the emotional temperature',
  };
  return map[role] ?? 'contributing to the discussion';
}

type ContributorPointSignals = {
  stanceExcerpt?: string;
  resonance?: WriterContributor['resonance'];
  agreementSignal?: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeStanceExcerpt(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[@#]\S+\s*/g, '')
    .trim()
    .slice(0, 180);
}

function buildContributorPointSignals(
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): Record<string, ContributorPointSignals> {
  const signalsByDid: Record<string, ContributorPointSignals> = {};

  type WorkingSignal = {
    did: string;
    bestExcerpt: string;
    bestReplyQuality: number;
    highestImpact: number;
    totalLikes: number;
    totalReplies: number;
    replyCount: number;
  };

  const workingByDid: Record<string, WorkingSignal> = {};

  for (const reply of replies) {
    const did = reply.authorDid;
    if (!did) continue;

    const score = scores[reply.uri];
    const impact = clamp01(score?.finalInfluenceScore ?? score?.usefulnessScore ?? 0);
    const likeCount = Math.max(0, reply.likeCount ?? 0);
    const replyCount = Math.max(0, reply.replyCount ?? 0);

    const engagement = clamp01((likeCount / 24) + (replyCount / 8));
    const replyQuality = clamp01((impact * 0.72) + (engagement * 0.28));
    const excerpt = normalizeStanceExcerpt(reply.text);

    const existing = workingByDid[did] ?? {
      did,
      bestExcerpt: '',
      bestReplyQuality: -1,
      highestImpact: 0,
      totalLikes: 0,
      totalReplies: 0,
      replyCount: 0,
    };

    existing.totalLikes += likeCount;
    existing.totalReplies += replyCount;
    existing.replyCount += 1;
    existing.highestImpact = Math.max(existing.highestImpact, impact);

    if (excerpt && replyQuality >= existing.bestReplyQuality) {
      existing.bestReplyQuality = replyQuality;
      existing.bestExcerpt = excerpt;
    }

    workingByDid[did] = existing;
  }

  for (const [did, signal] of Object.entries(workingByDid)) {
    const avgLikes = signal.totalLikes / Math.max(1, signal.replyCount);
    const avgReplies = signal.totalReplies / Math.max(1, signal.replyCount);
    const engagementNorm = clamp01((avgLikes / 14) + (avgReplies / 5));
    const resonanceScore = clamp01((signal.highestImpact * 0.68) + (engagementNorm * 0.32));

    const resonance: WriterContributor['resonance'] = resonanceScore >= 0.74
      ? 'high'
      : resonanceScore >= 0.52
        ? 'moderate'
        : 'emerging';

    const strongAgreement = avgLikes >= 8 || avgReplies >= 2;
    const moderateAgreement = avgLikes >= 4 || avgReplies >= 1;
    const agreementSignal = strongAgreement
      ? 'resonated strongly with other participants'
      : moderateAgreement
        ? 'drew visible agreement from other participants'
        : undefined;

    signalsByDid[did] = {
      ...(signal.bestExcerpt ? { stanceExcerpt: signal.bestExcerpt } : {}),
      ...(resonance ? { resonance } : {}),
      ...(agreementSignal ? { agreementSignal } : {}),
    };
  }

  return signalsByDid;
}

function buildStanceSummary(role: ContributionRole, excerpt?: string): string {
  if (excerpt && excerpt.length > 0) {
    return `main point: ${excerpt}`.slice(0, 200);
  }
  return mapRoleToStance(role).slice(0, 200);
}

function normalizeParticipantHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function shouldSurfaceContributorAsParticipantEntity(contributor: WriterContributor): boolean {
  if (contributor.impactScore >= 0.62) return true;
  return contributor.role === 'source-bringer'
    || contributor.role === 'rule-source'
    || contributor.role === 'counterpoint'
    || contributor.role === 'clarifier';
}

function buildParticipantEntities(
  rootHandle: string,
  contributors: WriterContributor[],
): WriterEntity[] {
  const entities: WriterEntity[] = [];
  const seen = new Set<string>();

  const addParticipant = (handle: string, impact: number, confidence: number): void => {
    const normalizedHandle = normalizeParticipantHandle(handle);
    if (!normalizedHandle || seen.has(normalizedHandle)) return;
    seen.add(normalizedHandle);
    entities.push({
      id: `person-${normalizedHandle.replace(/[^a-z0-9._-]/g, '-')}`,
      label: `@${normalizedHandle}`,
      type: 'person',
      confidence: clamp01(confidence),
      impact: clamp01(impact),
    });
  };

  addParticipant(rootHandle, 0.92, 0.99);

  contributors
    .filter((contributor) => shouldSurfaceContributorAsParticipantEntity(contributor))
    .sort((left, right) => right.impactScore - left.impactScore)
    .forEach((contributor) => {
      addParticipant(
        contributor.handle,
        Math.max(0.48, contributor.impactScore),
        contributor.resonance === 'high' ? 0.94 : 0.9,
      );
    });

  return entities.slice(0, 3);
}

function mergeSafeEntities(
  preferred: WriterEntity[],
  existing: WriterEntity[],
  maxEntities: number,
): WriterEntity[] {
  const merged = new Map<string, WriterEntity>();

  for (const entity of [...preferred, ...existing]) {
    const key = entity.label.trim().toLowerCase();
    if (!key) continue;
    const prior = merged.get(key);
    if (
      !prior
      || entity.confidence > prior.confidence
      || (entity.confidence === prior.confidence && entity.impact > prior.impact)
    ) {
      merged.set(key, entity);
    }
  }

  return [...merged.values()].slice(0, maxEntities);
}

function normalizeSignalExcerpt(value: string, maxLen = 88): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .trim();
}

function pushSignal(target: string[], prefix: string, rawText: string): void {
  const excerpt = normalizeSignalExcerpt(rawText);
  if (!excerpt) return;
  const signal = `${prefix}: ${excerpt}`;
  if (target.some((existing) => existing.toLowerCase() === signal.toLowerCase())) return;
  target.push(signal);
}

function toSafeEntityId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 64) || 'entity';
}

// ─── buildInterpretiveExplanation ─────────────────────────────────────────
// Derives a short, human-readable context string from confidence values and
// structural thread signals. The writer uses this to calibrate how strong an
// interpretation to make, without needing to parse floating-point thresholds.
// Pure function — no I/O. Never throws.

function buildInterpretiveExplanation(
  confidence: ConfidenceState,
  signals: WriterThreadSignalSummary,
): string {
  const parts: string[] = [];

  const { surfaceConfidence, interpretiveConfidence, entityConfidence } = confidence;

  // Surface clarity label
  if (surfaceConfidence >= 0.70) parts.push('high-clarity thread');
  else if (surfaceConfidence >= 0.45) parts.push('moderate-clarity thread');
  else parts.push('low-clarity thread');

  // Source signal
  if (signals.sourceBackedCount >= 2) {
    parts.push(`${signals.sourceBackedCount} source-backed replies`);
  } else if (signals.factualSignalPresent) {
    parts.push('factual signal present');
  }

  // Angle / clarification signal
  if (signals.newAnglesCount >= 2) {
    parts.push(`${signals.newAnglesCount} new angles`);
  } else if (signals.clarificationsCount >= 1) {
    parts.push(
      `${signals.clarificationsCount} clarification${signals.clarificationsCount > 1 ? 's' : ''}`,
    );
  }

  // Interpretive confidence label
  if (interpretiveConfidence >= 0.65) {
    parts.push('interpretation: high confidence');
  } else if (interpretiveConfidence >= 0.40) {
    parts.push('interpretation: medium confidence');
  } else {
    parts.push('interpretation: low confidence; hedge accordingly');
  }

  // Entity reliability label
  if (entityConfidence >= 0.60) {
    parts.push('entities: reliable');
  } else if (entityConfidence < 0.35) {
    parts.push('entities: uncertain; mention sparingly');
  }

  return parts.join('; ');
}

function sanitizeWriterMediaFindings(
  findings: ThreadStateForWriter['mediaFindings'],
): WriterMediaFinding[] {
  if (!Array.isArray(findings)) return [];

  return findings
    .filter((finding): finding is WriterMediaFinding => typeof finding === 'object' && finding !== null)
    .map((finding) => {
      const mediaType = ['screenshot', 'chart', 'document', 'photo', 'meme', 'unknown'].includes(finding.mediaType)
        ? finding.mediaType
        : 'unknown';
      const summary = finding.summary.replace(/\s+/g, ' ').trim().slice(0, 280);
      const confidence = Math.max(0, Math.min(1, Number.isFinite(finding.confidence) ? finding.confidence : 0));
      const cautionFlags = Array.isArray(finding.cautionFlags)
        ? Array.from(new Set(
            finding.cautionFlags
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.replace(/\s+/g, ' ').trim().slice(0, 80))
              .filter(Boolean),
          )).slice(0, 6)
        : [];
      const extractedText = typeof finding.extractedText === 'string'
        ? finding.extractedText.replace(/\s+/g, ' ').trim().slice(0, 280)
        : undefined;

      return {
        mediaType,
        summary,
        confidence,
        ...(extractedText ? { extractedText } : {}),
        ...(cautionFlags.length > 0 ? { cautionFlags } : {}),
      };
    })
    .filter((finding) => finding.summary.length > 0)
    .slice(0, 3);
}

function buildScoresByDid(
  replies: ThreadNode[],
  scores: Record<string, ContributionScores>,
): Record<string, ContributionScores> {
  const byDid: Record<string, ContributionScores> = {};

  for (const reply of replies) {
    const did = reply.authorDid;
    if (!did) continue;
    const score = scores[reply.uri];
    if (!score) continue;

    const existing = byDid[did];
    if (!existing || (score.finalInfluenceScore ?? score.usefulnessScore) > (existing.finalInfluenceScore ?? existing.usefulnessScore)) {
      byDid[did] = score;
    }
  }

  return byDid;
}

// ─── buildThreadStateForWriter ────────────────────────────────────────────

export function buildThreadStateForWriter(
  threadId: string,
  rootText: string,
  state: InterpolatorState,
  scores: Record<string, ContributionScores>,
  replies: ThreadNode[],
  confidence: ConfidenceState,
  translationById?: WriterTranslationMap,
  /** The actual handle of the root post author — used to correctly mark OP in contributor lists. */
  rootAuthorHandle?: string,
  options?: {
    summaryMode?: SummaryMode;
    mediaFindings?: ThreadStateForWriter['mediaFindings'];
  },
): ThreadStateForWriter {
  const debugAlgorithmTelemetry = import.meta.env.DEV
    || import.meta.env.VITE_DEBUG_ALGORITHM_COMPARISON === '1';

  const summaryMode: SummaryMode = options?.summaryMode
    ?? chooseSummaryMode({
      surfaceConfidence: confidence.surfaceConfidence,
      interpretiveConfidence: confidence.interpretiveConfidence,
    });

  const maxContributors = summaryMode === 'normal' ? 4 : summaryMode === 'descriptive_fallback' ? 3 : 2;

  // ── Selected comments ────────────────────────────────────────────────────
  const rawComments: WriterComment[] = replies.map(reply => {
    const score = scores[reply.uri];
    const translated = translationById?.[reply.uri]?.translatedText;

    // Penalize replies where verification found low factual confidence.
    // Only applies when factual evidence was actually computed (non-null factual).
    // Low-confidence factual signal (< 0.40) reduces influence by 30% so these
    // replies rank lower and are less likely to be included in the writer payload.
    const factualConfidence = score?.factual?.factualConfidence ?? null;
    const factualPenalty = (factualConfidence !== null && factualConfidence < 0.40) ? 0.70 : 1.0;
    const rawImpact = score?.finalInfluenceScore ?? score?.usefulnessScore ?? 0;

    const base: WriterComment = {
      uri: reply.uri,
      handle: reply.authorHandle,
      text: (translated ?? reply.text).slice(0, 280),
      impactScore: rawImpact * factualPenalty,
    };
    if (reply.authorName != null) base.displayName = reply.authorName;
    if (score?.role) base.role = score.role;
    if (reply.likeCount != null) base.liked = reply.likeCount;
    if (reply.replyCount != null) base.replied = reply.replyCount;
    return base;
  });

  // Sort by impact first, then apply diversity-aware selection
  const sortedRawComments = [...rawComments].sort((a, b) => b.impactScore - a.impactScore);
  const maxComments = summaryMode === 'normal' ? 10 : summaryMode === 'descriptive_fallback' ? 5 : 3;
  const selectedComments = selectDiverseComments(sortedRawComments, maxComments);

  // ── Top contributors ──────────────────────────────────────────────────────
  // OP is identified from the rootAuthorHandle argument when available.
  // Fall back to the first topContributor handle only if not provided.
  const opHandle = rootAuthorHandle ?? state.topContributors[0]?.handle ?? '';
  const scoreByDid = buildScoresByDid(replies, scores);
  const contributorPointSignals = buildContributorPointSignals(replies, scores);

  // Try algorithmic selection first; fall back to legacy if it fails
  let selectedContributorDids: string[];
  let selectionMethod: 'algorithmic' | 'algorithmic+stance' | 'legacy' = 'legacy';

  try {
    const algorithmicResult = selectContributorsAlgorithmic(
      state.topContributors,
      scoreByDid,
      {
        maxContributors,
        minInclusionThreshold: 0.35,
      },
    );

    if (algorithmicResult.selectedContributors.length > 0) {
      selectedContributorDids = algorithmicResult.selectedContributors.map(c => c.contributorDid);
      selectionMethod = 'algorithmic';

      try {
        const stanceClustering = clusterStanceCoverage(state.topContributors, scoreByDid);
        const stanceDiverseDids = filterByStanceDiversity(stanceClustering, maxContributors);
        if (stanceDiverseDids.length > 0) {
          const merged = Array.from(new Set([
            ...stanceDiverseDids.filter((did) => selectedContributorDids.includes(did)),
            ...selectedContributorDids,
            ...stanceDiverseDids,
          ]));

          // Remove contributors flagged as redundant within over-saturated stance
          // clusters. Always keep at least 1 contributor even if all are suppressed.
          const suppressedDids = new Set(
            stanceClustering.suggestedSuppressions.map((s) => s.did),
          );
          const afterSuppression = merged.filter((did) => !suppressedDids.has(did));
          selectedContributorDids = (afterSuppression.length > 0 ? afterSuppression : merged)
            .slice(0, maxContributors);
          selectionMethod = 'algorithmic+stance';
        }
      } catch (stanceErr) {
        _writerInputTelemetry.stanceFallbacks += 1;
        if (import.meta.env.DEV) {
          console.warn('[writerInput] stance_clustering_fallback', {
            ...toSafeErrorMeta(stanceErr),
            totalStanceFallbacks: _writerInputTelemetry.stanceFallbacks,
          });
        }
        // Keep baseline algorithmic selection when stance clustering is unavailable.
      }
    } else {
      // Algorithm returned no selection, use legacy
      const legacy = selectContributors(
        state.topContributors,
        replies,
        scores,
        opHandle,
        summaryMode,
      );
      selectedContributorDids = legacy.map(c => c.contributor.did);
    }
  } catch (err) {
    _writerInputTelemetry.algorithmicSelectionFallbacks += 1;
    console.error('[writerInput] contributor_selection_fallback', {
      ...toSafeErrorMeta(err),
      contributorCount: state.topContributors.length,
      replyCount: replies.length,
      totalFallbacks: _writerInputTelemetry.algorithmicSelectionFallbacks,
    });
    // Fallback to legacy selection
    const legacy = selectContributors(
      state.topContributors,
      replies,
      scores,
      opHandle,
      summaryMode,
    );
    selectedContributorDids = legacy.map(c => c.contributor.did);
  }

  // Map selected DIDs back to full contributor objects
  const selectedContributors = state.topContributors
    .filter(c => selectedContributorDids.includes(c.did))
    .map(c => ({ contributor: c }));

  // Telemetry: log selection method
  if (debugAlgorithmTelemetry && Math.random() < 0.1) { // Log 10% of samples to reduce noise
    console.log('[writerInput] Contributor selection:', {
      method: selectionMethod,
      count: selectedContributorDids.length,
    });

    if (debugAlgorithmTelemetry) {
      const comparison = compareSelectionApproaches(state.topContributors, scoreByDid);
      console.log('[writerInput] Selection comparison:', {
        agreementCount: comparison.agreementCount,
        algorithmImprovement: comparison.algorithmImprovement,
        algorithmicCount: comparison.algorithmicResult.selectedContributors.length,
        legacyCount: comparison.legacyResult.length,
      });
    }
  }

  const topContributors: WriterContributor[] = selectedContributors.map(({ contributor: c }) => {
    const pointSignals = c.did ? contributorPointSignals[c.did] : undefined;
    const excerpt = pointSignals?.stanceExcerpt;
    const contrib: WriterContributor = {
      handle: c.handle ?? c.did.slice(-8),
      role: mapRole(c.dominantRole),
      impactScore: c.avgUsefulnessScore,
      stanceSummary: buildStanceSummary(c.dominantRole, excerpt),
      ...(excerpt ? { stanceExcerpt: excerpt } : {}),
      ...(pointSignals?.resonance ? { resonance: pointSignals.resonance } : {}),
      ...(pointSignals?.agreementSignal ? { agreementSignal: pointSignals.agreementSignal } : {}),
    };
    if (c.did) contrib.did = c.did;
    return contrib;
  });

  // ── Safe entities ─────────────────────────────────────────────────────────
  // Filter and rank entities using centrality scoring with fallback to mention counts.
  const rankedEntities = state.entityLandscape
    .filter(e => entityMayBeNamed(
      e.matchConfidence ?? 0.50,
      Math.min(1, e.mentionCount / 10),
      summaryMode,
    ))
    .sort((a, b) => b.mentionCount - a.mentionCount);

  let safeEntities: WriterEntity[] = [];
  let entityThemes: string[] = [];

  try {
    const dedupedEntities = new Map<string, EntityInfo>();
    const linkedEntityConfidences = new Map<string, number>();
    const lowerRootText = rootText.toLowerCase();

    for (const entity of rankedEntities) {
      const id = entity.canonicalEntityId ?? toSafeEntityId(entity.entityText);
      if (!dedupedEntities.has(id)) {
        dedupedEntities.set(id, {
          id,
          label: (entity.canonicalLabel ?? entity.entityText).slice(0, 128),
          type: ENTITY_TYPE_MAP[entity.entityKind] ?? 'topic',
          mentionCount: Math.max(0, entity.mentionCount),
        });
      }
      linkedEntityConfidences.set(id, Math.max(linkedEntityConfidences.get(id) ?? 0, entity.matchConfidence ?? 0.5));
    }

    const rootMentionedEntities = new Set<string>();
    for (const [id, entity] of dedupedEntities) {
      if (lowerRootText.includes(entity.label.toLowerCase())) {
        rootMentionedEntities.add(id);
      }
    }

    const mentionsByContributor = new Map<string, Set<string>>();
    for (const reply of replies) {
      const did = reply.authorDid;
      if (!did) continue;
      const score = scores[reply.uri];
      if (!score) continue;

      const existing = mentionsByContributor.get(did) ?? new Set<string>();
      for (const impact of score.entityImpacts ?? []) {
        existing.add(impact.canonicalEntityId ?? toSafeEntityId(impact.entityText));
      }
      mentionsByContributor.set(did, existing);
    }

    const centralityScores = computeEntityCentralityScores(
      Array.from(dedupedEntities.values()),
      rootText,
      rootMentionedEntities,
      state.topContributors,
      scoreByDid,
      replies.map((reply) => reply.authorDid).filter((did): did is string => Boolean(did)),
      mentionsByContributor,
      linkedEntityConfidences,
    );

    const centralityResult = buildEntityCentralityResult(centralityScores);
    const topEntities = getTopCentralEntities(
      centralityResult.topCentral.length > 0 ? centralityResult.topCentral : centralityResult.entities,
      8,
    );

    safeEntities = topEntities.map((entity) => ({
      id: entity.entityId,
      label: entity.entityLabel,
      type: entity.entityType,
      confidence: entity.canonicalConfidence,
      impact: entity.centralityScore,
    }));

    // Capture derived themes for the writer — these are human-readable topic frames
    // derived from top central entities with inclusion reasons (e.g. "Policy revision",
    // "AI (fact-checked)"). Stored in a closure variable consumed below.
    if (centralityResult.themes.length > 0) {
      entityThemes = centralityResult.themes;
    }
  } catch (err) {
    console.warn('[writerInput] entity_centrality_fallback', {
      ...toSafeErrorMeta(err),
      candidateEntityCount: rankedEntities.length,
      contributorCount: state.topContributors.length,
    });
    safeEntities = [];
  }

  if (safeEntities.length === 0) {
    safeEntities = rankedEntities
      .slice(0, 8)
      .map(e => ({
        id: e.canonicalEntityId ?? toSafeEntityId(e.entityText),
        label: e.canonicalLabel ?? e.entityText,
        type: ENTITY_TYPE_MAP[e.entityKind] ?? 'topic',
        confidence: e.matchConfidence ?? 0.50,
        impact: Math.min(1, e.mentionCount / 10),
      }));
  }

  const participantEntities = buildParticipantEntities(
    rootAuthorHandle ?? opHandle,
    topContributors,
  );
  safeEntities = mergeSafeEntities(participantEntities, safeEntities, 10);

  // ── Factual highlights ────────────────────────────────────────────────────
  const factualHighlights: string[] = [];
  for (const [uri, score] of Object.entries(scores)) {
    const state_ = score.factual?.factualState;
    if (state_ === 'well-supported' || state_ === 'source-backed-clarification' || state_ === 'partially-supported') {
      const comment = rawComments.find(c => c.uri === uri);
      if (comment) factualHighlights.push(comment.text.slice(0, 120));
    }
  }

  // ── What-changed signals ──────────────────────────────────────────────────
  const whatChangedSignals: string[] = [];

  state.clarificationsAdded.slice(0, 2).forEach((clarification) => {
    pushSignal(whatChangedSignals, 'clarification', clarification);
  });
  state.newAnglesAdded.slice(0, 2).forEach((angle) => {
    pushSignal(whatChangedSignals, 'new angle', angle);
  });

  rawComments
    .filter((comment) => {
      const score = scores[comment.uri];
      if (!score) return false;
      return score.role === 'source_bringer'
        || score.role === 'rule_source'
        || score.sourceSupport >= 0.55
        || score.evidenceSignals.some((signal) => signal.kind === 'citation');
    })
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 2)
    .forEach((comment) => {
      pushSignal(whatChangedSignals, 'source cited', comment.text);
    });

  rawComments
    .filter((comment) => {
      const score = scores[comment.uri];
      return score?.role === 'useful_counterpoint';
    })
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 2)
    .forEach((comment) => {
      pushSignal(whatChangedSignals, 'counterpoint', comment.text);
    });

  rawComments
    .filter((comment) => {
      const score = scores[comment.uri];
      return score?.role === 'new_information';
    })
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 1)
    .forEach((comment) => {
      pushSignal(whatChangedSignals, 'new info', comment.text);
    });

  // ── Root post ─────────────────────────────────────────────────────────────
  const rootPost = {
    uri: state.rootUri,
    handle: (rootAuthorHandle ?? opHandle) || 'op',
    text: (translationById?.[state.rootUri]?.translatedText ?? rootText).slice(0, 500),
    createdAt: state.updatedAt,
  };
  const mediaFindings = sanitizeWriterMediaFindings(options?.mediaFindings);

  // ── Thread signal summary ─────────────────────────────────────────────────
  // Structural counts derived from pipeline state — never exposes user content.
  const scoreList = Object.values(scores);
  const sourceBackedCount = scoreList.filter(
    (s) => s.sourceSupport >= 0.5 || (s.factual?.factualConfidence ?? 0) >= 0.55,
  ).length;

  const threadSignalSummary: WriterThreadSignalSummary = {
    newAnglesCount: state.newAnglesAdded.length,
    clarificationsCount: state.clarificationsAdded.length,
    sourceBackedCount,
    factualSignalPresent: state.factualSignalPresent,
    evidencePresent: state.evidencePresent,
  };

  const interpretiveExplanation = buildInterpretiveExplanation(confidence, threadSignalSummary);

  return {
    threadId,
    summaryMode,
    confidence,
    visibleReplyCount: replies.length,
    rootPost,
    selectedComments,
    topContributors,
    safeEntities,
    factualHighlights: factualHighlights.slice(0, 5),
    whatChangedSignals: whatChangedSignals.slice(0, 6),
    ...(mediaFindings.length > 0 ? { mediaFindings } : {}),
    threadSignalSummary,
    interpretiveExplanation,
    ...(entityThemes.length > 0 ? { entityThemes } : {}),
  };
}

// ─── buildExploreSynopsisInput ────────────────────────────────────────────
// Builds the request shape for /llm/write/search-story.
// Reuses the same entity/confidence structure as the thread writer.

export { buildThreadStateForWriter as default };
