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
  callPremiumDeepInterpolator,
  getPremiumAiEntitlements,
} from '../intelligence/modelClient';
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
  deriveThreadStateSignal,
} from './sessionPolicies';
import { applyInterpretiveConfidence } from './interpretive/interpretiveScoring';
import { humanizeInterpretiveReason } from './interpretive/interpretiveExplanation';
import { detectMentalHealthCrisis } from '../lib/sentiment';
import type {
  AtUri,
  ThreadPost,
} from '../intelligence/interpolatorTypes';
import type {
  InterpolatorWriteResult,
  ThreadStateForWriter,
} from '../intelligence/llmContracts';
import type {
  PremiumInterpolatorRequest,
  PremiumAiEntitlements,
} from '../intelligence/premiumContracts';
import type { MockPost } from '../data/mockData';
import type {
  ConversationNode,
  ConversationSessionMode,
  ConversationDirection,
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

function deriveConversationDirectionFromSession(session: ConversationSession): ConversationDirection {
  const threadState = session.interpretation.threadState;
  if (!threadState) return 'forming';
  if (threadState.conversationPhase === 'escalating') return 'escalating';
  if (threadState.conversationPhase === 'stalled') return 'stalled';
  if (threadState.dominantTone === 'constructive') return 'clarifying';
  if (threadState.dominantTone === 'contested') return 'fragmenting';
  return 'forming';
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
        direction: deriveConversationDirectionFromSession(nextSession),
      },
    };

    store.updateSession(sessionId, () => nextSession!);

    const interpolatorEnabled = useInterpolatorSettingsStore.getState().enabled;
    if (!interpolatorEnabled) {
      return;
    }

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

      store.updateSession(sessionId, (current) => ({
        ...current,
        translations: {
          byUri: {
            ...current.translations.byUri,
            ...translationById,
          },
        },
      }));

      const writerInput = buildThreadStateForWriter(
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
        },
      );

      const writerResult = await callInterpolatorWriter(writerInput, signal);
      const filteredWriterResult = redactWriterResultByUserRules(writerResult);
      if (!filteredWriterResult.abstained) {
        store.updateSession(sessionId, (current) => ({
          ...current,
          interpretation: {
            ...current.interpretation,
            writerResult: filteredWriterResult,
          },
        }));
      }

      const actorDid = useSessionStore.getState().session?.did?.trim();
      if (!actorDid) {
        store.updateSession(sessionId, (current) => ({
          ...current,
          interpretation: {
            ...current.interpretation,
            premium: {
              status: 'not_entitled',
            },
          },
        }));
        return;
      }

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

      if (!shouldRunPremiumDeepInterpolator(currentSession, allReplies.length, entitlements)) {
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

      const baseSummary = !filteredWriterResult.abstained
        ? filteredWriterResult.collapsedSummary
        : currentSession.interpretation.interpolator?.summaryText;

      const premiumInput = redactPremiumInterpolatorInputByUserRules(
        buildPremiumInterpolatorRequest({
          actorDid,
          writerInput,
          session: currentSession,
          ...(baseSummary ? { baseSummary } : {}),
        }),
      );

      const deepInterpolator = await callPremiumDeepInterpolator(premiumInput, signal);
      const sourceComputedAt = currentSession.interpretation.lastComputedAt;

      store.updateSession(sessionId, (current) => ({
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
      }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      store.updateSession(sessionId, (current) => ({
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
            ...(sanitizeErrorMessage(err)
              ? { lastError: sanitizeErrorMessage(err) }
              : {}),
          },
        },
      }));
      // Non-fatal: deterministic interpolation remains available.
      console.warn('[conversation] optional translation/writer step failed', sanitizeErrorMessage(err));
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return;
    }
    setSessionError(sessionId, sanitizeErrorMessage(err));
  }
}
