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
  detectMediaSignals,
  deriveMediaFactualHints,
  mergeMediaResults,
  selectMediaForAnalysis,
  shouldRunMultimodal,
} from '../intelligence/mediaInput';
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
import {
  buildConversationModelSourceToken,
  matchesConversationModelSourceToken,
} from './modelSourceToken';
import {
  markConversationModelDiscarded,
  markConversationModelError,
  markConversationModelLoading,
  markConversationModelReady,
  markConversationModelSkipped,
  shouldRunInterpolatorWriter,
} from './modelExecution';
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
  PremiumInterpolatorRequest,
  PremiumAiEntitlements,
} from '../intelligence/premiumContracts';
import type { MockPost } from '../data/mockData';
import type {
  ConversationNode,
  ConversationSessionMode,
  ConversationSession,
  SessionTranslationState,
  MentalHealthCrisisCategory,
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

type ThreadMediaAnalysisPlan =
  | {
      shouldRun: false;
      reason: 'multimodal_not_needed' | 'no_media_candidates';
    }
  | {
      shouldRun: true;
      requests: ReturnType<typeof selectMediaForAnalysis>;
    };

type ThreadMediaAnalysisOutcome =
  | {
      status: 'ready';
      findings: WriterMediaFinding[];
      attempted: number;
      failures: number;
    }
  | {
      status: 'error';
      error: string;
      attempted: number;
      failures: number;
    };

function planThreadMediaAnalysis(params: {
  threadId: string;
  root: ThreadNode;
  replies: ThreadNode[];
  scores: Record<string, ContributionScores>;
  nearbyTextByUri: Record<string, string | undefined>;
}): ThreadMediaAnalysisPlan {
  const {
    threadId,
    root,
    replies,
    scores,
    nearbyTextByUri,
  } = params;

  const mediaSignals = detectMediaSignals(root, replies, scores);
  if (!shouldRunMultimodal(mediaSignals)) {
    return {
      shouldRun: false,
      reason: 'multimodal_not_needed',
    };
  }

  const requests = selectMediaForAnalysis(
    threadId,
    root,
    replies,
    scores,
    {
      nearbyTextByUri,
      factualHints: deriveMediaFactualHints(replies, scores),
    },
  );

  if (requests.length === 0) {
    return {
      shouldRun: false,
      reason: 'no_media_candidates',
    };
  }

  return {
    shouldRun: true,
    requests,
  };
}

async function executeThreadMediaAnalysis(params: {
  threadId: string;
  requests: ReturnType<typeof selectMediaForAnalysis>;
  signal?: AbortSignal;
}): Promise<ThreadMediaAnalysisOutcome> {
  const { threadId, requests, signal } = params;
  const results = [];
  let failures = 0;

  for (const request of requests) {
    try {
      results.push(await callMediaAnalyzer(request, signal));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      failures += 1;
    }
  }

  if (failures > 0) {
    console.warn('[conversation] multimodal analysis degraded', {
      threadId,
      attempted: requests.length,
      failures,
    });
  }

  if (results.length === 0) {
    return {
      status: 'error',
      error: 'Multimodal analysis failed for all selected media.',
      attempted: requests.length,
      failures,
    };
  }

  return {
    status: 'ready',
    findings: mergeMediaResults(results),
    attempted: requests.length,
    failures,
  };
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

function redactPremiumInterpolatorInputByUserRules(
  input: PremiumInterpolatorRequest,
  rules: KeywordFilterRule[] = useContentFilterStore.getState().rules,
): PremiumInterpolatorRequest {
  return {
    ...input,
    rootPost: {
      ...input.rootPost,
      text: redactTextByUserRules(input.rootPost.text, rules),
    },
    selectedComments: input.selectedComments.map((comment) => ({
      ...comment,
      text: redactTextByUserRules(comment.text, rules),
    })),
    factualHighlights: input.factualHighlights.map((value) => redactTextByUserRules(value, rules)),
    whatChangedSignals: input.whatChangedSignals.map((value) => redactTextByUserRules(value, rules)),
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

function shouldRunPremiumDeepInterpolator(
  session: ConversationSession,
  replyCount: number,
  entitlements: PremiumAiEntitlements,
): boolean {
  if (!entitlements.providerAvailable) return false;
  if (!entitlements.capabilities.includes('deep_interpolator')) return false;
  if (session.interpretation.summaryMode === 'minimal_fallback') return false;

  const confidence = session.interpretation.confidence;
  const surfaceConfidence = confidence?.surfaceConfidence ?? 0;
  const interpretiveConfidence = confidence?.interpretiveConfidence ?? 0;
  const hasSourceSignal = session.interpretation.interpolator?.sourceSupportPresent ?? false;
  const hasFactualSignal = session.interpretation.interpolator?.factualSignalPresent ?? false;

  if (replyCount >= 5) return true;
  if (hasSourceSignal || hasFactualSignal) return true;
  return surfaceConfidence >= 0.65 || interpretiveConfidence >= 0.55;
}

function buildPremiumInterpolatorRequest(params: {
  actorDid: string;
  writerInput: ThreadStateForWriter;
  session: ConversationSession;
  baseSummary?: string;
}): PremiumInterpolatorRequest {
  const { actorDid, writerInput, session, baseSummary } = params;
  const explanation = session.interpretation.interpretiveExplanation;

  return {
    actorDid,
    ...writerInput,
    interpretiveBrief: {
      summaryMode: writerInput.summaryMode,
      ...(baseSummary ? { baseSummary } : {}),
      ...(session.interpretation.threadState?.dominantTone
        ? { dominantTone: session.interpretation.threadState.dominantTone }
        : {}),
      ...(session.interpretation.threadState?.conversationPhase
        ? { conversationPhase: session.interpretation.threadState.conversationPhase }
        : {}),
      supports: explanation
        ? explanation.boostedBy.slice(0, 4).map(humanizeInterpretiveReason)
        : [],
      limits: explanation
        ? explanation.degradedBy.slice(0, 4).map(humanizeInterpretiveReason)
        : [],
    },
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

  try {
    const response = await atpCall(
      () => agent.getPostThread({ uri: rootUri, depth: 6 }),
      {
        ...THREAD_RETRY_DEFAULTS,
        ...(signal ? { signal } : {}),
      },
    );

    const envelope = asThreadPostEnvelope(response);
    const threadData = envelope.data?.thread;
    if (!threadData || threadData.$type !== 'app.bsky.feed.defs#threadViewPost') {
      setSessionError(sessionId, 'Thread not found.');
      return;
    }

    const rootNode = resolveThread(threadData as never);
    const allReplies = flattenThreadReplies(rootNode.replies ?? []);
    const graph = buildSessionGraph(rootNode);

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

    store.updateSession(sessionId, (current) => ({
      ...current,
      graph,
      interpretation: {
        ...current.interpretation,
        interpolator: pipeline.interpolator,
        scoresByUri: pipeline.scores,
        confidence: pipeline.confidence,
        summaryMode: pipeline.summaryMode,
        writerResult: null,
        mediaFindings: [],
        threadState: null,
        interpretiveExplanation: null,
        lastComputedAt: new Date().toISOString(),
        premium: {
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
    }));

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
    nextSession = assignDeferredReasons(nextSession, defaultAnchorLinearPolicy);
    nextSession = {
      ...nextSession,
      trajectory: {
        ...nextSession.trajectory,
        direction: deriveConversationDirection(nextSession),
      },
    };
    nextSession = updateConversationContinuitySnapshots(nextSession);

    store.updateSession(sessionId, () => nextSession!);
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

    const writerGate = shouldRunInterpolatorWriter(nextSession, allReplies.length);
    if (!writerGate.shouldRun) {
      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped(current, 'writer', {
          reason: writerGate.reason,
          sourceToken: modelSourceToken,
        })
      ));
      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped(current, 'multimodal', {
          reason: writerGate.reason,
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

      const translationById = buildTranslationMap({
        rootUri,
        targetLang: translationPolicy.userLanguage,
        output: translationOutput,
      });

      store.updateSession(sessionId, (current) => (
        matchesConversationModelSourceToken(current, modelSourceToken)
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
      if (!matchesConversationModelSourceToken(sessionAfterTranslation, modelSourceToken)) {
        store.updateSession(sessionId, (current) => markConversationModelDiscarded(current, 'writer'));
        return;
      }

      const nearbyTextByUri = buildNearbyTextByUri({
        rootUri,
        rootText: rootNode.text,
        replies: allReplies,
        translationById,
      });

      const mediaPlan = planThreadMediaAnalysis({
        threadId: rootUri,
        root: rootNode,
        replies: allReplies,
        scores: pipeline.scores,
        nearbyTextByUri,
      });

      if (!mediaPlan.shouldRun) {
        store.updateSession(sessionId, (current) => (
          matchesConversationModelSourceToken(current, modelSourceToken)
            ? markConversationModelSkipped(current, 'multimodal', {
                reason: mediaPlan.reason,
                sourceToken: modelSourceToken,
              })
            : markConversationModelDiscarded(current, 'multimodal')
        ));
      } else {
        const multimodalRequestedAt = new Date().toISOString();
        store.updateSession(sessionId, (current) => (
          matchesConversationModelSourceToken(current, modelSourceToken)
            ? markConversationModelLoading(current, 'multimodal', {
                sourceToken: modelSourceToken,
                requestedAt: multimodalRequestedAt,
              })
            : markConversationModelDiscarded(current, 'multimodal')
        ));

        const mediaOutcome = await executeThreadMediaAnalysis({
          threadId: rootUri,
          requests: mediaPlan.requests,
          ...(signal ? { signal } : {}),
        });

        mediaFindings = mediaOutcome.status === 'ready' ? mediaOutcome.findings : [];
        store.updateSession(sessionId, (current) => {
          if (!matchesConversationModelSourceToken(current, modelSourceToken)) {
            return markConversationModelDiscarded(current, 'multimodal');
          }

          if (mediaOutcome.status === 'error') {
            return markConversationModelError(current, 'multimodal', {
              sourceToken: modelSourceToken,
              requestedAt: multimodalRequestedAt,
              error: mediaOutcome.error,
            });
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

          return markConversationModelReady(nextCurrent, 'multimodal', {
            sourceToken: modelSourceToken,
            requestedAt: multimodalRequestedAt,
          });
        });
      }

      const sessionAfterMedia = store.getSession(sessionId);
      if (!sessionAfterMedia) return;
      if (!matchesConversationModelSourceToken(sessionAfterMedia, modelSourceToken)) {
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
          summaryMode: nextSession.interpretation.summaryMode ?? pipeline.summaryMode,
          ...(mediaFindings.length > 0 ? { mediaFindings } : {}),
        },
      );

      const writerResult = await callInterpolatorWriter(writerInput, signal);
      filteredWriterResult = redactWriterResultByUserRules(writerResult);
      store.updateSession(sessionId, (current) => {
        if (!matchesConversationModelSourceToken(current, modelSourceToken)) {
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

        return markConversationModelReady(nextCurrent, 'writer', {
          sourceToken: modelSourceToken,
          requestedAt: writerRequestedAt,
        });
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = sanitizeErrorMessage(err);
      store.updateSession(sessionId, (current) => (
        matchesConversationModelSourceToken(current, modelSourceToken)
          ? markConversationModelError(current, 'writer', {
              sourceToken: modelSourceToken,
              requestedAt: writerRequestedAt,
              error: errorMessage,
            })
          : markConversationModelDiscarded(current, 'writer')
      ));
      console.warn('[conversation] writer step failed', errorMessage);
      return;
    }

    const actorDid = useSessionStore.getState().session?.did?.trim();
    if (!actorDid) {
      store.updateSession(sessionId, (current) => (
        markConversationModelSkipped({
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
        })
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
      const entitlements = await getPremiumAiEntitlements(actorDid, signal);
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
      if (!matchesConversationModelSourceToken(currentSession, modelSourceToken)) {
        store.updateSession(sessionId, (current) => markConversationModelDiscarded(current, 'premium'));
        return;
      }

      if (!shouldRunPremiumDeepInterpolator(currentSession, allReplies.length, entitlements)) {
        store.updateSession(sessionId, (current) => (
          markConversationModelSkipped(current, 'premium', {
            reason: entitlements.capabilities.includes('deep_interpolator')
              ? 'premium_ineligible'
              : 'not_entitled',
            sourceToken: modelSourceToken,
          })
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
          session: currentSession,
          ...(baseSummary ? { baseSummary } : {}),
        }),
      );

      const deepInterpolator = await callPremiumDeepInterpolator(premiumInput, signal);
      const sourceComputedAt = currentSession.interpretation.lastComputedAt;

      store.updateSession(sessionId, (current) => ({
        ...(matchesConversationModelSourceToken(current, modelSourceToken)
          ? markConversationModelReady({
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
            })
          : markConversationModelDiscarded(current, 'premium')),
      }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorMessage = sanitizeErrorMessage(err);
      store.updateSession(sessionId, (current) => (
        matchesConversationModelSourceToken(current, modelSourceToken)
          ? markConversationModelError({
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
            })
          : markConversationModelDiscarded(current, 'premium')
      ));
      console.warn('[conversation] premium interpolation failed', errorMessage);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return;
    }
    setSessionError(sessionId, sanitizeErrorMessage(err));
  }
}
