import { atpCall } from '../lib/atproto/client';
import { isAtUri, resolveThread } from '../lib/resolver/atproto';
import type { ThreadNode } from '../lib/resolver/atproto';
import {
  runVerifiedThreadPipeline,
  nodeToThreadPost,
} from '../intelligence/index';
import { THREAD_RETRY_DEFAULTS } from '../intelligence/retry';
import { buildThreadStateForWriter } from '../intelligence/writerInput';
import {
  callInterpolatorWriter,
  callMediaAnalyzer,
  callPremiumDeepInterpolator,
  getPremiumAiEntitlements,
} from '../intelligence/modelClient';
import {
  planConversationCoordinatorMediaStage,
  executeConversationCoordinatorMediaStage,
  type ConversationCoordinatorMediaPlan,
} from './coordinatorMediaStageExecutor';
import { translateWriterInput } from '../lib/i18n/threadTranslation';
import type { VerificationProviders } from '../intelligence/verification/types';
import type { VerificationCache } from '../intelligence/verification/cache';
import { buildSessionGraph } from './sessionGraph';
import { useConversationSessionStore } from './sessionStore';
import { useContentFilterStore } from '../store/contentFilterStore';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';
import { useSessionStore } from '../store/sessionStore';
import {
  activeRulesForContext,
  getKeywordMatches,
  getSemanticMatches,
  searchableTextForPost,
} from '../lib/contentFilters/match';
import {
  annotateConversationQuality,
  assignDeferredReasons,
  defaultAnchorLinearPolicy,
  deriveConversationDirection,
  deriveThreadStateSignal,
} from './sessionPolicies';
import { applyInterpretiveConfidence } from './interpretive/interpretiveScoring';
import { humanizeInterpretiveReason } from './interpretive/interpretiveExplanation';
import { updateConversationContinuitySnapshots } from './continuitySnapshots';
import { finalizeConversationDeltaDecision } from './deltaDecision';
import { applyShadowConversationSupervisor } from './shadowSupervisor';
import { buildConversationModelSourceToken } from './modelSourceToken';
import { selectCoordinatorSourceApplication } from './coordinatorSourceGuards';
import {
  createConversationCoordinatorContextSnapshot,
  selectConversationCoordinatorDecision,
} from './coordinatorRuntime';
import {
  markConversationModelDiscarded,
  markConversationModelError,
  markConversationModelLoading,
  markConversationModelReady,
  markConversationModelSkipped,
  shouldRunPremiumDeepInterpolator,
} from './modelExecution';
import {
  planConversationCoordinatorModelStages,
  type ConversationCoordinatorMultimodalPlanningInput,
} from './coordinatorModelStagePlanner';
import {
  recordInterpolatorGateDecision,
  recordInterpolatorModeDecision,
  recordInterpolatorStageTiming,
} from '../perf/interpolatorTelemetry';
import { detectMentalHealthCrisis } from '../lib/sentiment';
import type {
  AtUri,
  ContributionScores,
  ThreadPost,
} from '../intelligence/interpolatorTypes';
import type {
  InterpolatorWriteResult,
  ThreadStateForWriter,
  WriterMediaFinding,
} from '../intelligence/llmContracts';
import type {
  PremiumAiEntitlements,
  PremiumInterpolatorRequest,
} from '../intelligence/premiumContracts';
import type { MockPost } from '../data/mockData';
import type {
  ConversationNode,
  ConversationSessionMode,
  ConversationSession,
  SessionTranslationState,
  MentalHealthCrisisCategory,
  ThreadStateSignal,
  InterpretiveConfidenceExplanation,
  ConversationModelRunSkipReason,
} from './sessionTypes';
import type { KeywordFilterRule } from '../lib/contentFilters/types';

type ThreadAgent = {
  getPostThread: (input: { uri: string; depth: number }) => Promise<unknown>;
};

interface ThreadViewPostEnvelope {
  data?: {
    thread?: {
      $type?: string;
      post?: unknown;
    };
  };
}

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const sanitized = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  if (!sanitized) return 'Unexpected error while hydrating conversation session.';
  return sanitized.slice(0, 220);
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

const MAX_COORDINATOR_REASON_CODES = 8;
const MAX_COORDINATOR_REASON_CODE_LENGTH = 56;

function sanitizeCoordinatorReasonCodes(reasonCodes: readonly string[]): string[] {
  const sanitized = reasonCodes
    .map((code) => code.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim())
    .filter((code) => code.length > 0)
    .map((code) => code.slice(0, MAX_COORDINATOR_REASON_CODE_LENGTH));
  return Array.from(new Set(sanitized)).slice(0, MAX_COORDINATOR_REASON_CODES);
}

export interface ConversationCoordinatorRuntimeAdvisory {
  action: ReturnType<typeof selectConversationCoordinatorDecision>['action'];
  reasonCodes: string[];
  activeStageCount: number;
  errorStageCount: number;
  staleStageCount: number;
}

export function summarizeConversationCoordinatorRuntimeAdvisory(
  session: ConversationSession,
): ConversationCoordinatorRuntimeAdvisory {
  const snapshot = createConversationCoordinatorContextSnapshot(session);
  const decision = selectConversationCoordinatorDecision(snapshot);

  return {
    action: decision.action,
    reasonCodes: sanitizeCoordinatorReasonCodes(decision.reasonCodes),
    activeStageCount: snapshot.activeStages.length,
    errorStageCount: snapshot.errorStages.length,
    staleStageCount: snapshot.staleStages.length,
  };
}

function flattenThreadReplies(replies: ThreadNode[]): ThreadNode[] {
  const flattened: ThreadNode[] = [];

  const visit = (nodes: ThreadNode[]): void => {
    for (const node of nodes) {
      flattened.push(node);
      if (node.replies.length > 0) {
        visit(node.replies);
      }
    }
  };

  visit(replies);
  return flattened;
}

function setSessionError(sessionId: string, message: string): void {
  const store = useConversationSessionStore.getState();
  store.updateSession(sessionId, (current) => ({
    ...current,
    meta: {
      ...current.meta,
      status: 'error',
      error: message,
    },
  }));
}

function buildTranslationMap(params: {
  rootUri: AtUri;
  targetLang: string;
  output: Awaited<ReturnType<typeof translateWriterInput>>;
}): SessionTranslationState['byUri'] {
  const { rootUri, targetLang, output } = params;

  const byUri: SessionTranslationState['byUri'] = {
    [rootUri]: {
      ...(output.rootPost.translatedText ? { translatedText: output.rootPost.translatedText } : {}),
      sourceLang: output.rootPost.sourceLang,
      targetLang,
    },
  };

  for (const comment of output.selectedComments) {
    byUri[comment.id] = {
      ...(comment.translatedText ? { translatedText: comment.translatedText } : {}),
      sourceLang: comment.sourceLang,
      targetLang,
    };
  }

  return byUri;
}

function buildNearbyTextByUri(params: {
  rootUri: AtUri;
  rootText: string;
  replies: ThreadNode[];
  translationById: SessionTranslationState['byUri'];
}): Record<string, string | undefined> {
  const { rootUri, rootText, replies, translationById } = params;
  const byUri: Record<string, string | undefined> = {
    [rootUri]: translationById[rootUri]?.translatedText ?? rootText,
  };

  for (const reply of replies) {
    byUri[reply.uri] = translationById[reply.uri]?.translatedText ?? reply.text;
  }

  return byUri;
}

const DEFAULT_COORDINATOR_PLANNER_ENTITLEMENTS: PremiumAiEntitlements = {
  tier: 'free',
  capabilities: [],
  providerAvailable: false,
};

function toCoordinatorMultimodalPlanningInput(
  mediaPlan: ConversationCoordinatorMediaPlan,
): ConversationCoordinatorMultimodalPlanningInput {
  if (!mediaPlan.shouldRun) {
    return {
      shouldRun: false,
      reason: mediaPlan.reason,
    };
  }

  return {
    shouldRun: true,
    requests: mediaPlan.requests,
  };
}

function resolveCoordinatorPlannerEntitlements(session: ConversationSession): PremiumAiEntitlements {
  return session.interpretation.premium.entitlements ?? DEFAULT_COORDINATOR_PLANNER_ENTITLEMENTS;
}

function coerceSkipReason(
  reason: ConversationModelRunSkipReason | 'run_ready',
  fallback: ConversationModelRunSkipReason,
): ConversationModelRunSkipReason {
  return reason === 'run_ready' ? fallback : reason;
}

function asThreadPostEnvelope(value: unknown): ThreadViewPostEnvelope {
  if (typeof value !== 'object' || value == null) return {};
  return value as ThreadViewPostEnvelope;
}

function nodeToFilterablePost(node: ConversationNode): MockPost {
  return {
    id: node.uri,
    author: {
      did: node.authorDid,
      handle: node.authorHandle,
      displayName: node.authorName ?? node.authorHandle,
      ...(node.authorAvatar ? { avatar: node.authorAvatar } : {}),
    },
    content: node.text,
    ...(node.facets?.length ? { facets: node.facets } : {}),
    createdAt: node.createdAt,
    likeCount: node.likeCount,
    replyCount: node.replyCount,
    repostCount: node.repostCount,
    bookmarkCount: 0,
    chips: [],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseVariants(phrase: string): string[] {
  const cleaned = phrase.trim();
  if (!cleaned) return [];
  const normalized = cleaned.replace(/^#+/, '');
  const variants = new Set<string>();
  variants.add(cleaned);
  if (normalized) {
    variants.add(normalized);
    variants.add(`#${normalized}`);
  }
  return [...variants];
}

function redactByRule(text: string, rule: KeywordFilterRule): string {
  let next = text;
  const variants = phraseVariants(rule.phrase);
  for (const variant of variants) {
    if (!variant) continue;
    const escaped = escapeRegex(variant);
    const pattern = rule.wholeWord
      ? new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=[^\\p{L}\\p{N}_]|$)`, 'giu')
      : new RegExp(escaped, 'giu');
    next = next.replace(pattern, (match, prefix?: string, term?: string) => {
      if (rule.wholeWord) {
        const safePrefix = typeof prefix === 'string' ? prefix : '';
        return `${safePrefix}[filtered]`;
      }
      return '[filtered]';
    });
  }
  return next;
}

export function redactWriterResultByUserRules(
  writerResult: InterpolatorWriteResult,
  rules: KeywordFilterRule[] = useContentFilterStore.getState().rules,
): InterpolatorWriteResult {
  const activeRules = activeRulesForContext(rules, 'thread');
  const keywordRules = activeRules.filter((rule) => rule.enabled && rule.phrase.trim().length > 0);
  if (keywordRules.length === 0) return writerResult;

  const redactText = (value: string): string => {
    let next = value;
    for (const rule of keywordRules) {
      next = redactByRule(next, rule);
    }
    return next;
  };

  return {
    ...writerResult,
    collapsedSummary: redactText(writerResult.collapsedSummary),
    ...(writerResult.expandedSummary
      ? { expandedSummary: redactText(writerResult.expandedSummary) }
      : {}),
    whatChanged: writerResult.whatChanged.map((item) => redactText(item)),
    contributorBlurbs: writerResult.contributorBlurbs.map((entry) => ({
      ...entry,
      blurb: redactText(entry.blurb),
    })),
  };
}

function redactTextByUserRules(
  value: string,
  rules: KeywordFilterRule[] = useContentFilterStore.getState().rules,
): string {
  const activeRules = activeRulesForContext(rules, 'thread');
  const keywordRules = activeRules.filter((rule) => rule.enabled && rule.phrase.trim().length > 0);
  if (keywordRules.length === 0) return value;

  let next = value;
  for (const rule of keywordRules) {
    next = redactByRule(next, rule);
  }
  return next;
}

export function redactPremiumInterpolatorInputByUserRules(
  input: PremiumInterpolatorRequest,
  rules: KeywordFilterRule[] = useContentFilterStore.getState().rules,
): PremiumInterpolatorRequest {
  return {
    ...input,
    rootPost: {
      ...input.rootPost,
      text: redactTextByUserRules(input.rootPost.text, rules),
    },
    topContributors: input.topContributors.map((contributor) => ({
      ...contributor,
      handle: redactTextByUserRules(contributor.handle, rules),
      stanceSummary: redactTextByUserRules(contributor.stanceSummary, rules),
      ...(contributor.stanceExcerpt
        ? { stanceExcerpt: redactTextByUserRules(contributor.stanceExcerpt, rules) }
        : {}),
      ...(contributor.agreementSignal
        ? { agreementSignal: redactTextByUserRules(contributor.agreementSignal, rules) }
        : {}),
    })),
    safeEntities: input.safeEntities.map((entity) => ({
      ...entity,
      label: redactTextByUserRules(entity.label, rules),
    })),
    selectedComments: input.selectedComments.map((comment) => ({
      ...comment,
      text: redactTextByUserRules(comment.text, rules),
    })),
    factualHighlights: input.factualHighlights.map((value) => redactTextByUserRules(value, rules)),
    whatChangedSignals: input.whatChangedSignals.map((value) => redactTextByUserRules(value, rules)),
    ...(input.mediaFindings
      ? {
          mediaFindings: input.mediaFindings.map((finding) => ({
            ...finding,
            summary: redactTextByUserRules(finding.summary, rules),
            ...(finding.extractedText
              ? { extractedText: redactTextByUserRules(finding.extractedText, rules) }
              : {}),
            ...(finding.cautionFlags
              ? { cautionFlags: finding.cautionFlags.map((value) => redactTextByUserRules(value, rules)) }
              : {}),
          })),
        }
      : {}),
    ...(input.interpretiveExplanation
      ? { interpretiveExplanation: redactTextByUserRules(input.interpretiveExplanation, rules) }
      : {}),
    ...(input.entityThemes
      ? { entityThemes: input.entityThemes.map((value) => redactTextByUserRules(value, rules)) }
      : {}),
    interpretiveBrief: {
      ...input.interpretiveBrief,
      ...(input.interpretiveBrief.baseSummary
        ? { baseSummary: redactTextByUserRules(input.interpretiveBrief.baseSummary, rules) }
        : {}),
      supports: input.interpretiveBrief.supports.map((value) => redactTextByUserRules(value, rules)),
      limits: input.interpretiveBrief.limits.map((value) => redactTextByUserRules(value, rules)),
    },
  };
}

export function buildPremiumInterpretiveBrief(params: {
  writerInput: ThreadStateForWriter;
  threadState?: ThreadStateSignal | null;
  interpretiveExplanation?: InterpretiveConfidenceExplanation | null;
  baseSummary?: string;
}): PremiumInterpolatorRequest['interpretiveBrief'] {
  const {
    writerInput,
    threadState,
    interpretiveExplanation,
    baseSummary,
  } = params;

  return {
    summaryMode: writerInput.summaryMode,
    ...(baseSummary ? { baseSummary } : {}),
    ...(threadState?.dominantTone
      ? { dominantTone: threadState.dominantTone }
      : {}),
    ...(threadState?.conversationPhase
      ? { conversationPhase: threadState.conversationPhase }
      : {}),
    supports: interpretiveExplanation
      ? interpretiveExplanation.boostedBy.slice(0, 4).map(humanizeInterpretiveReason)
      : [],
    limits: interpretiveExplanation
      ? interpretiveExplanation.degradedBy.slice(0, 4).map(humanizeInterpretiveReason)
      : [],
  };
}

export function buildPremiumInterpolatorRequest(params: {
  actorDid: string;
  writerInput: ThreadStateForWriter;
  threadState?: ThreadStateSignal | null;
  interpretiveExplanation?: InterpretiveConfidenceExplanation | null;
  baseSummary?: string;
}): PremiumInterpolatorRequest {
  const {
    actorDid,
    writerInput,
    threadState,
    interpretiveExplanation,
    baseSummary,
  } = params;
  return {
    actorDid,
    ...writerInput,
    interpretiveBrief: buildPremiumInterpretiveBrief({
      writerInput,
      ...(threadState !== undefined ? { threadState } : {}),
      ...(interpretiveExplanation !== undefined ? { interpretiveExplanation } : {}),
      ...(baseSummary !== undefined ? { baseSummary } : {}),
    }),
  };
}

async function applyModerationFlagsFromUserFilters(session: ConversationSession): Promise<ConversationSession> {
  const rules = useContentFilterStore.getState().rules;
  const activeRules = activeRulesForContext(rules, 'thread');
  if (activeRules.length === 0) return session;

  const nextNodes: Record<AtUri, ConversationNode> = { ...session.graph.nodesByUri };
  const nodes = Object.values(nextNodes);

  for (const node of nodes) {
    const post = nodeToFilterablePost(node);
    const text = searchableTextForPost(post);
    const keywordMatches = getKeywordMatches(text, activeRules);
    const semanticMatches = await getSemanticMatches(text, activeRules);
    const matches = [...keywordMatches, ...semanticMatches];

    const hasHide = matches.some((match) => match.action === 'hide');
    const hasWarn = matches.some((match) => match.action === 'warn');

    if (!hasHide && !hasWarn) continue;

    nextNodes[node.uri] = {
      ...node,
      hiddenByModeration: Boolean(node.hiddenByModeration || hasHide),
      warnedByModeration: Boolean(node.warnedByModeration || hasWarn),
    };
  }

  return {
    ...session,
    graph: {
      ...session.graph,
      nodesByUri: nextNodes,
    },
  };
}

export interface HydrateConversationSessionParams {
  sessionId: string;
  rootUri: string;
  mode?: ConversationSessionMode;
  agent: ThreadAgent;
  translationPolicy: {
    userLanguage: string;
    localOnlyMode: boolean;
  };
  providers: VerificationProviders;
  cache: VerificationCache;
  signal?: AbortSignal;
}

export async function hydrateConversationSession(
  params: HydrateConversationSessionParams,
): Promise<void> {
  const {
    sessionId,
    rootUri,
    mode = 'thread',
    agent,
    translationPolicy,
    providers,
    cache,
    signal,
  } = params;

  const store = useConversationSessionStore.getState();
  store.ensureSession(sessionId, rootUri, mode);

  store.updateSession(sessionId, (current) => ({
    ...current,
    mode,
    meta: {
      ...current.meta,
      status: 'loading',
      error: null,
    },
  }));

  if (!isAtUri(rootUri)) {
    setSessionError(sessionId, 'Invalid AT URI.');
    return;
  }

  const hydrateStartedAt = nowMs();
  try {
    const threadFetchStartedAt = nowMs();
    const response = await atpCall(
      () => agent.getPostThread({ uri: rootUri, depth: 6 }),
      {
        ...THREAD_RETRY_DEFAULTS,
        ...(signal ? { signal } : {}),
      },
    );
    recordInterpolatorStageTiming('hydrate.fetch_thread', nowMs() - threadFetchStartedAt);

    const envelope = asThreadPostEnvelope(response);
    const threadData = envelope.data?.thread;
    if (!threadData || threadData.$type !== 'app.bsky.feed.defs#threadViewPost') {
      setSessionError(sessionId, 'Thread not found.');
      return;
    }

    const rootNode = resolveThread(threadData as never);
    const allReplies = flattenThreadReplies(rootNode.replies ?? []);
    const graph = buildSessionGraph(rootNode);

    const pipelineStartedAt = nowMs();
    const pipeline = await runVerifiedThreadPipeline({
      input: {
        rootUri,
        rootText: rootNode.text,
        rootPost: nodeToThreadPost(rootNode),
        replies: allReplies,
      },
      previous: store.getSession(sessionId)?.interpretation.interpolator ?? null,
      providers,
      cache,
      ...(signal ? { signal } : {}),
    });
    recordInterpolatorStageTiming('hydrate.verified_pipeline', nowMs() - pipelineStartedAt);

    store.updateSession(sessionId, (current) => {
      const preserveExistingOutputs = !pipeline.didMeaningfullyChange;

      return {
        ...current,
        graph,
        interpretation: {
          ...current.interpretation,
          interpolator: pipeline.interpolator,
          scoresByUri: pipeline.scores,
          confidence: pipeline.confidence,
          summaryMode: pipeline.summaryMode,
          deltaDecision: pipeline.deltaDecision,
          writerResult: preserveExistingOutputs
            ? current.interpretation.writerResult
            : null,
          mediaFindings: preserveExistingOutputs
            ? (current.interpretation.mediaFindings ?? [])
            : [],
          threadState: null,
          interpretiveExplanation: null,
          ...(
            preserveExistingOutputs
              ? (
                  current.interpretation.lastComputedAt
                    ? { lastComputedAt: current.interpretation.lastComputedAt }
                    : {}
                )
              : { lastComputedAt: new Date().toISOString() }
          ),
          premium: preserveExistingOutputs
            ? current.interpretation.premium
            : {
                status: 'idle',
                ...(current.interpretation.premium.entitlements
                  ? { entitlements: current.interpretation.premium.entitlements }
                  : {}),
              },
        },
        evidence: {
          verificationByUri: pipeline.verificationByPost,
          rootVerification: pipeline.rootVerification,
        },
        entities: {
          ...current.entities,
          entityLandscape: pipeline.interpolator.entityLandscape ?? [],
        },
        contributors: {
          contributors: pipeline.interpolator.topContributors ?? [],
          topContributorDids: (pipeline.interpolator.topContributors ?? []).map((c) => c.did),
        },
        trajectory: {
          ...current.trajectory,
          heatLevel: pipeline.interpolator.heatLevel ?? 0,
          repetitionLevel: pipeline.interpolator.repetitionLevel ?? 0,
        },
        meta: {
          status: 'ready',
          error: null,
          lastHydratedAt: new Date().toISOString(),
        },
      };
    });

    let nextSession = store.getSession(sessionId);
    if (!nextSession) return;

    nextSession = await applyModerationFlagsFromUserFilters(nextSession);

    // ─── Mental health crisis scan ─────────────────────────────────────
    // Check root post + top replies for crisis signals. Runs regardless of
    // whether the Interpolator is enabled — safety is not opt-out.
    const mhTexts = [
      rootNode.text,
      ...allReplies.slice(0, 10).map((r) => r.text),
    ];
    let mentalHealthSignal: { detected: boolean; category?: MentalHealthCrisisCategory } = {
      detected: false,
    };
    for (const text of mhTexts) {
      const mhResult = detectMentalHealthCrisis(text);
      if (mhResult.hasCrisis) {
        mentalHealthSignal = mhResult.category
          ? { detected: true, category: mhResult.category }
          : { detected: true };
        break;
      }
    }
    nextSession = {
      ...nextSession,
      interpretation: {
        ...nextSession.interpretation,
        mentalHealthSignal,
      },
    };
    // ──────────────────────────────────────────────────────────────────

    nextSession = annotateConversationQuality(nextSession);
    nextSession = applyInterpretiveConfidence(nextSession);
    nextSession = {
      ...nextSession,
      interpretation: {
        ...nextSession.interpretation,
        threadState: deriveThreadStateSignal(nextSession),
      },
    };
    nextSession = finalizeConversationDeltaDecision(nextSession, pipeline.deltaDecision);
    nextSession = assignDeferredReasons(nextSession, defaultAnchorLinearPolicy);
    nextSession = {
      ...nextSession,
      trajectory: {
        ...nextSession.trajectory,
        direction: deriveConversationDirection(nextSession),
      },
    };
    nextSession = updateConversationContinuitySnapshots(nextSession);
    nextSession = applyShadowConversationSupervisor(nextSession, 'session_hydrated');

    store.updateSession(sessionId, () => nextSession!);

    const coordinatorSnapshotStartedAt = nowMs();
    const coordinatorRuntimeAdvisory = summarizeConversationCoordinatorRuntimeAdvisory(nextSession);
    recordInterpolatorStageTiming('hydrate.coordinator_snapshot', nowMs() - coordinatorSnapshotStartedAt);
    if (coordinatorRuntimeAdvisory.action !== 'continue') {
      console.warn('[conversation] coordinator runtime advisory', {
        sessionId,
        action: coordinatorRuntimeAdvisory.action,
        reasonCodes: coordinatorRuntimeAdvisory.reasonCodes,
        activeStageCount: coordinatorRuntimeAdvisory.activeStageCount,
        errorStageCount: coordinatorRuntimeAdvisory.errorStageCount,
        staleStageCount: coordinatorRuntimeAdvisory.staleStageCount,
      });
    }

    const modelSourceToken = buildConversationModelSourceToken(nextSession);

    const interpolatorEnabled = useInterpolatorSettingsStore.getState().enabled;
    if (!interpolatorEnabled) {
      store.updateSession(sessionId, (current) => markConversationModelSkipped(current, 'writer', {
        reason: 'interpolator_disabled',
        sourceToken: modelSourceToken,
      }));
      store.updateSession(sessionId, (current) => markConversationModelSkipped(current, 'multimodal', {
        reason: 'interpolator_disabled',
        sourceToken: modelSourceToken,
      }));
      store.updateSession(sessionId, (current) => markConversationModelSkipped(current, 'premium', {
        reason: 'premium_ineligible',
        sourceToken: modelSourceToken,
      }));
      return;
    }

    recordInterpolatorModeDecision(
      nextSession.interpretation.deltaDecision?.summaryMode ?? pipeline.deltaDecision.summaryMode,
      nextSession.interpretation.deltaDecision?.confidence ?? pipeline.deltaDecision.confidence,
    );

    const preflightStagePlan = planConversationCoordinatorModelStages({
      session: nextSession,
      replyCount: allReplies.length,
      interpolatorEnabled,
      didMeaningfullyChange: pipeline.didMeaningfullyChange,
      multimodalPlan: {
        shouldRun: false,
        reason: 'multimodal_not_needed',
      },
      premiumEntitlements: resolveCoordinatorPlannerEntitlements(nextSession),
    });

    const writerPreflightPlan = preflightStagePlan.plans.writer;
    recordInterpolatorGateDecision(writerPreflightPlan.action === 'run');
    if (writerPreflightPlan.action === 'skip') {
      const writerSkipReason = coerceSkipReason(writerPreflightPlan.reason, 'insufficient_signal');
      if (writerSkipReason === 'no_meaningful_change') {
        store.updateSession(sessionId, (current) => (
          markConversationModelSkipped(current, 'writer', {
            reason: writerSkipReason,
            sourceToken: modelSourceToken,
          })
        ));
        store.updateSession(sessionId, (current) => (
          markConversationModelSkipped(current, 'multimodal', {
            reason: writerSkipReason,
            sourceToken: modelSourceToken,
          })
        ));
        store.updateSession(sessionId, (current) => (
          markConversationModelSkipped(current, 'premium', {
            reason: 'no_meaningful_change',
            sourceToken: modelSourceToken,
          })
        ));
        return;
      }

      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped(current, 'writer', {
          reason: writerSkipReason,
          sourceToken: modelSourceToken,
        })
      ));
      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped(current, 'multimodal', {
          reason: writerSkipReason,
          sourceToken: modelSourceToken,
        })
      ));
      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped(current, 'premium', {
          reason: 'premium_ineligible',
          sourceToken: modelSourceToken,
        })
      ));
      return;
    }

    const writerRequestedAt = new Date().toISOString();
    store.updateSession(sessionId, (current) => (
      markConversationModelLoading(current, 'writer', {
        sourceToken: modelSourceToken,
        requestedAt: writerRequestedAt,
      })
    ));

    let filteredWriterResult: InterpolatorWriteResult | null = null;
    let writerInput: ThreadStateForWriter | null = null;
    let mediaFindings: WriterMediaFinding[] = [];

    try {
      const translationStartedAt = nowMs();
      const translationOutput = await translateWriterInput({
        rootPost: {
          id: rootNode.uri,
          text: rootNode.text,
        },
        selectedComments: [...allReplies]
          .sort((left, right) => (
            (pipeline.scores[right.uri]?.finalInfluenceScore
              ?? pipeline.scores[right.uri]?.usefulnessScore
              ?? 0)
            - (pipeline.scores[left.uri]?.finalInfluenceScore
              ?? pipeline.scores[left.uri]?.usefulnessScore
              ?? 0)
          ))
          .slice(0, 24)
          .map((reply) => ({
            id: reply.uri,
            text: reply.text,
          })),
        targetLang: translationPolicy.userLanguage,
        mode: translationPolicy.localOnlyMode ? 'local_private' : 'server_default',
      });
      recordInterpolatorStageTiming('hydrate.translation', nowMs() - translationStartedAt);

      const translationById = buildTranslationMap({
        rootUri,
        targetLang: translationPolicy.userLanguage,
        output: translationOutput,
      });

      store.updateSession(sessionId, (current) => (
        selectCoordinatorSourceApplication(current, modelSourceToken, 'writer').action === 'apply'
          ? {
              ...current,
              translations: {
                byUri: {
                  ...current.translations.byUri,
                  ...translationById,
                },
              },
            }
          : markConversationModelDiscarded(current, 'writer')
      ));

      const sessionAfterTranslation = store.getSession(sessionId);
      if (!sessionAfterTranslation) return;
      if (selectCoordinatorSourceApplication(sessionAfterTranslation, modelSourceToken, 'writer').action === 'discard_stale') {
        store.updateSession(sessionId, (current) => markConversationModelDiscarded(current, 'writer'));
        return;
      }

      const nearbyTextByUri = buildNearbyTextByUri({
        rootUri,
        rootText: rootNode.text,
        replies: allReplies,
        translationById,
      });

      const mediaPlan = planConversationCoordinatorMediaStage({
        threadId: rootUri,
        root: rootNode,
        replies: allReplies,
        scores: pipeline.scores,
        nearbyTextByUri,
      });

      const multimodalStagePlan = planConversationCoordinatorModelStages({
        session: sessionAfterTranslation,
        replyCount: allReplies.length,
        interpolatorEnabled: true,
        didMeaningfullyChange: true,
        multimodalPlan: toCoordinatorMultimodalPlanningInput(mediaPlan),
        premiumEntitlements: resolveCoordinatorPlannerEntitlements(sessionAfterTranslation),
      }).plans.multimodal;

      if (multimodalStagePlan.action === 'skip') {
        const multimodalSkipReason = coerceSkipReason(multimodalStagePlan.reason, 'multimodal_not_needed');
        store.updateSession(sessionId, (current) => (
          selectCoordinatorSourceApplication(current, modelSourceToken, 'multimodal').action === 'apply'
            ? markConversationModelSkipped(current, 'multimodal', {
                reason: multimodalSkipReason,
                sourceToken: modelSourceToken,
              })
            : markConversationModelDiscarded(current, 'multimodal')
        ));
      } else {
        if (!mediaPlan.shouldRun) {
          store.updateSession(sessionId, (current) => (
            selectCoordinatorSourceApplication(current, modelSourceToken, 'multimodal').action === 'apply'
              ? markConversationModelSkipped(current, 'multimodal', {
                  reason: 'multimodal_not_needed',
                  sourceToken: modelSourceToken,
                })
              : markConversationModelDiscarded(current, 'multimodal')
          ));
          return;
        }

        const multimodalRequestedAt = new Date().toISOString();
        store.updateSession(sessionId, (current) => (
          selectCoordinatorSourceApplication(current, modelSourceToken, 'multimodal').action === 'apply'
            ? markConversationModelLoading(current, 'multimodal', {
                sourceToken: modelSourceToken,
                requestedAt: multimodalRequestedAt,
              })
            : markConversationModelDiscarded(current, 'multimodal')
        ));

        const multimodalStartedAt = nowMs();
        const mediaOutcome = await executeConversationCoordinatorMediaStage({
          threadId: rootUri,
          requests: mediaPlan.requests,
          analyzeMedia: callMediaAnalyzer,
          logFailure: (ev) => console.warn('[conversation] multimodal analysis degraded', ev),
          ...(signal ? { signal } : {}),
        });
        recordInterpolatorStageTiming('hydrate.multimodal', nowMs() - multimodalStartedAt);

        mediaFindings = mediaOutcome.status === 'ready' ? mediaOutcome.findings : [];
        store.updateSession(sessionId, (current) => {
          if (selectCoordinatorSourceApplication(current, modelSourceToken, 'multimodal').action === 'discard_stale') {
            return markConversationModelDiscarded(current, 'multimodal');
          }

          if (mediaOutcome.status === 'error') {
            return applyShadowConversationSupervisor(markConversationModelError(current, 'multimodal', {
              sourceToken: modelSourceToken,
              requestedAt: multimodalRequestedAt,
              error: mediaOutcome.error,
            }), 'multimodal_completed');
          }

          const nextCurrent = mediaFindings.length > 0
            ? {
                ...current,
                interpretation: {
                  ...current.interpretation,
                  mediaFindings,
                },
              }
            : current;

          return applyShadowConversationSupervisor(markConversationModelReady(nextCurrent, 'multimodal', {
            sourceToken: modelSourceToken,
            requestedAt: multimodalRequestedAt,
          }), 'multimodal_completed');
        });
      }

      const sessionAfterMedia = store.getSession(sessionId);
      if (!sessionAfterMedia) return;
      if (selectCoordinatorSourceApplication(sessionAfterMedia, modelSourceToken, 'writer').action === 'discard_stale') {
        store.updateSession(sessionId, (current) => markConversationModelDiscarded(
          markConversationModelDiscarded(current, 'multimodal'),
          'writer',
        ));
        return;
      }

      writerInput = buildThreadStateForWriter(
        rootUri,
        rootNode.text,
        pipeline.interpolator,
        pipeline.scores,
        allReplies,
        nextSession.interpretation.confidence ?? pipeline.confidence,
        Object.fromEntries(
          Object.entries(translationById).map(([uri, value]) => [
            uri,
            {
              ...(value.translatedText ? { translatedText: value.translatedText } : {}),
              ...(value.sourceLang ? { sourceLang: value.sourceLang } : {}),
            },
          ]),
        ),
        rootNode.authorHandle ?? undefined,
        {
          summaryMode: nextSession.interpretation.deltaDecision?.summaryMode ?? nextSession.interpretation.summaryMode ?? pipeline.deltaDecision.summaryMode,
          ...(mediaFindings.length > 0 ? { mediaFindings } : {}),
          deltaDecision: nextSession.interpretation.deltaDecision ?? pipeline.deltaDecision,
        },
      );
      const preparedWriterInput = writerInput;

      store.updateSession(sessionId, (current) => (
        selectCoordinatorSourceApplication(current, modelSourceToken, 'writer').action === 'apply'
          ? {
              ...current,
              entities: {
                ...current.entities,
                writerEntities: preparedWriterInput.safeEntities,
              },
            }
          : markConversationModelDiscarded(current, 'writer')
      ));

      const writerStartedAt = nowMs();
      const writerResult = await callInterpolatorWriter(preparedWriterInput, signal);
      recordInterpolatorStageTiming('hydrate.writer', nowMs() - writerStartedAt);
      filteredWriterResult = redactWriterResultByUserRules(writerResult);
      store.updateSession(sessionId, (current) => {
        if (selectCoordinatorSourceApplication(current, modelSourceToken, 'writer').action === 'discard_stale') {
          return markConversationModelDiscarded(current, 'writer');
        }

        const nextCurrent = !filteredWriterResult?.abstained
          ? updateConversationContinuitySnapshots({
              ...current,
              interpretation: {
                ...current.interpretation,
                writerResult: filteredWriterResult,
              },
            })
          : current;

        return applyShadowConversationSupervisor(markConversationModelReady(nextCurrent, 'writer', {
          sourceToken: modelSourceToken,
          requestedAt: writerRequestedAt,
        }), 'writer_completed');
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = sanitizeErrorMessage(err);
      store.updateSession(sessionId, (current) => (
        selectCoordinatorSourceApplication(current, modelSourceToken, 'writer').action === 'apply'
          ? applyShadowConversationSupervisor(markConversationModelError(current, 'writer', {
              sourceToken: modelSourceToken,
              requestedAt: writerRequestedAt,
              error: errorMessage,
            }), 'writer_completed')
          : markConversationModelDiscarded(current, 'writer')
      ));
      console.warn('[conversation] writer step failed', errorMessage);
      return;
    }

    const actorDid = useSessionStore.getState().session?.did?.trim();
    if (!actorDid) {
      store.updateSession(sessionId, (current) => (
        applyShadowConversationSupervisor(markConversationModelSkipped({
          ...current,
          interpretation: {
            ...current.interpretation,
            premium: {
              status: 'not_entitled',
            },
          },
        }, 'premium', {
          reason: 'not_entitled',
          sourceToken: modelSourceToken,
        }), 'premium_completed')
      ));
      return;
    }

    const premiumRequestedAt = new Date().toISOString();
    store.updateSession(sessionId, (current) => ({
      ...markConversationModelLoading(current, 'premium', {
        sourceToken: modelSourceToken,
        requestedAt: premiumRequestedAt,
      }),
      interpretation: {
        ...current.interpretation,
        premium: {
          ...(current.interpretation.premium.entitlements
            ? { entitlements: current.interpretation.premium.entitlements }
            : {}),
          status: 'loading',
        },
      },
    }));

    try {
      const premiumEntitlementsStartedAt = nowMs();
      const entitlements = await getPremiumAiEntitlements(actorDid, signal);
      recordInterpolatorStageTiming('hydrate.premium_entitlements', nowMs() - premiumEntitlementsStartedAt);
      store.updateSession(sessionId, (current) => ({
        ...current,
        interpretation: {
          ...current.interpretation,
          premium: {
            entitlements,
            status: entitlements.capabilities.includes('deep_interpolator')
              ? 'idle'
              : 'not_entitled',
          },
        },
      }));

      const currentSession = store.getSession(sessionId);
      if (!currentSession) return;
      if (selectCoordinatorSourceApplication(currentSession, modelSourceToken, 'premium').action === 'discard_stale') {
        store.updateSession(sessionId, (current) => markConversationModelDiscarded(current, 'premium'));
        return;
      }

      if (!shouldRunPremiumDeepInterpolator(currentSession, allReplies.length, entitlements)) {
        store.updateSession(sessionId, (current) => (
          applyShadowConversationSupervisor(markConversationModelSkipped(current, 'premium', {
            reason: entitlements.capabilities.includes('deep_interpolator')
              ? 'premium_ineligible'
              : 'not_entitled',
            sourceToken: modelSourceToken,
          }), 'premium_completed')
        ));
        return;
      }

      store.updateSession(sessionId, (current) => ({
        ...current,
        interpretation: {
          ...current.interpretation,
          premium: {
            entitlements,
            status: 'loading',
          },
        },
      }));

      const baseSummary = filteredWriterResult && !filteredWriterResult.abstained
        ? filteredWriterResult.collapsedSummary
        : currentSession.interpretation.interpolator?.summaryText;

      const premiumInput = redactPremiumInterpolatorInputByUserRules(
        buildPremiumInterpolatorRequest({
          actorDid,
          writerInput: writerInput!,
          threadState: currentSession.interpretation.threadState,
          interpretiveExplanation: currentSession.interpretation.interpretiveExplanation,
          ...(baseSummary ? { baseSummary } : {}),
        }),
      );

      const deepInterpolatorStartedAt = nowMs();
      const deepInterpolator = await callPremiumDeepInterpolator(premiumInput, signal);
      recordInterpolatorStageTiming('hydrate.premium_deep', nowMs() - deepInterpolatorStartedAt);
      const sourceComputedAt = currentSession.interpretation.lastComputedAt;

      store.updateSession(sessionId, (current) => ({
        ...(selectCoordinatorSourceApplication(current, modelSourceToken, 'premium').action === 'apply'
          ? applyShadowConversationSupervisor(markConversationModelReady({
              ...current,
              interpretation: {
                ...current.interpretation,
                premium: {
                  entitlements,
                  status: 'ready',
                  deepInterpolator: {
                    ...deepInterpolator,
                    ...(sourceComputedAt ? { sourceComputedAt } : {}),
                  },
                },
              },
            }, 'premium', {
              sourceToken: modelSourceToken,
              requestedAt: premiumRequestedAt,
            }), 'premium_completed')
          : markConversationModelDiscarded(current, 'premium')),
      }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = sanitizeErrorMessage(err);
      store.updateSession(sessionId, (current) => ({
        ...(selectCoordinatorSourceApplication(current, modelSourceToken, 'premium').action === 'apply'
          ? applyShadowConversationSupervisor(markConversationModelError({
              ...current,
              interpretation: {
                ...current.interpretation,
                premium: {
                  ...(current.interpretation.premium.entitlements
                    ? { entitlements: current.interpretation.premium.entitlements }
                    : {}),
                  status: current.interpretation.premium.entitlements?.capabilities.includes('deep_interpolator')
                    ? 'error'
                    : current.interpretation.premium.status,
                  ...(errorMessage
                    ? { lastError: errorMessage }
                    : {}),
                },
              },
            }, 'premium', {
              sourceToken: modelSourceToken,
              requestedAt: premiumRequestedAt,
              error: errorMessage,
            }), 'premium_completed')
          : markConversationModelDiscarded(current, 'premium')),
      }));
      console.warn('[conversation] premium interpolation failed', errorMessage);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return;
    }
    setSessionError(sessionId, sanitizeErrorMessage(err));
  } finally {
    recordInterpolatorStageTiming('hydrate.total', nowMs() - hydrateStartedAt);
  }
}
