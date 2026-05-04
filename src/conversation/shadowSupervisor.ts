import type { WriterMediaFinding } from '../intelligence/llmContracts';
import { recordConversationSupervisorDecision } from '../perf/conversationSupervisorTelemetry';
import type { ConversationSession } from './sessionTypes';
import type {
  ConversationSupervisorAction,
  ConversationSupervisorDecision,
  ConversationSupervisorState,
  ConversationSupervisorStateSummary,
  ConversationSupervisorTraceCode,
  ConversationSupervisorTrigger,
} from './supervisorTypes';

const DEFAULT_SUPERVISOR_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_RECOMMENDATIONS = 3;

function clampRate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function createEmptySupervisorState(): ConversationSupervisorState {
  return {
    mode: 'shadow',
    decisionsEvaluated: 0,
    recommendationsIssued: 0,
    cooldownSuppressions: 0,
    currentRecommendations: [],
    lastDecision: null,
  };
}

function sanitizeRationale(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 180);
}

function toIsoTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function inferMultimodalAuthority(mediaFindings: WriterMediaFinding[] | undefined): ConversationSupervisorStateSummary['multimodalAuthority'] {
  if (!mediaFindings || mediaFindings.length === 0) return 'none';
  return mediaFindings.some((finding) => (
    finding.analysisStatus === 'degraded' || finding.moderationStatus === 'unavailable'
  ))
    ? 'low_authority'
    : 'authoritative';
}

function buildStateSummary(session: ConversationSession): ConversationSupervisorStateSummary {
  const writerDiagnostics = session.interpretation.aiDiagnostics?.writer;
  const multimodalDiagnostics = session.interpretation.aiDiagnostics?.multimodal;
  const premiumDiagnostics = session.interpretation.aiDiagnostics?.premium;
  const lastMutationAt = toIsoTimestamp(session.mutations.lastMutationAt);
  const lastHydratedAt = toIsoTimestamp(session.meta.lastHydratedAt);
  const activeTasks = [
    writerDiagnostics?.status === 'loading' ? 'writer' : null,
    multimodalDiagnostics?.status === 'loading' ? 'multimodal' : null,
    premiumDiagnostics?.status === 'loading' ? 'premium' : null,
  ].filter((value): value is 'writer' | 'multimodal' | 'premium' => value !== null);
  const errorTasks = [
    writerDiagnostics?.status === 'error' ? 'writer' : null,
    multimodalDiagnostics?.status === 'error' ? 'multimodal' : null,
    premiumDiagnostics?.status === 'error' ? 'premium' : null,
  ].filter((value): value is 'writer' | 'multimodal' | 'premium' => value !== null);

  return {
    summaryMode: session.interpretation.summaryMode,
    confidence: session.interpretation.confidence,
    didMeaningfullyChange: Boolean(session.interpretation.deltaDecision?.didMeaningfullyChange),
    changeMagnitude: clampRate(session.interpretation.deltaDecision?.changeMagnitude ?? 0),
    activeTasks,
    errorTasks,
    premiumStatus: session.interpretation.premium.status,
    multimodalAuthority: inferMultimodalAuthority(session.interpretation.mediaFindings),
    hasMutationChurn: Boolean(
      lastMutationAt
      && (!lastHydratedAt || Date.parse(lastMutationAt) > Date.parse(lastHydratedAt))
    ),
    mutationRevision: session.mutations.revision,
  };
}

function addAction(
  actions: ConversationSupervisorAction[],
  action: ConversationSupervisorAction,
  maxRecommendations: number,
): void {
  if (actions.length >= maxRecommendations) return;
  if (actions.some((existing) => existing.type === action.type)) return;
  actions.push({
    ...action,
    rationale: sanitizeRationale(action.rationale),
  });
}

function buildRecommendations(params: {
  session: ConversationSession;
  trigger: ConversationSupervisorTrigger;
  summary: ConversationSupervisorStateSummary;
  maxRecommendations: number;
}): {
  actions: ConversationSupervisorAction[];
  traceCodes: ConversationSupervisorTraceCode[];
} {
  const { session, summary, maxRecommendations } = params;
  const writerDiagnostics = session.interpretation.aiDiagnostics?.writer;
  const multimodalDiagnostics = session.interpretation.aiDiagnostics?.multimodal;
  const premiumDiagnostics = session.interpretation.aiDiagnostics?.premium;
  const actions: ConversationSupervisorAction[] = [];
  const traceCodes: ConversationSupervisorTraceCode[] = [];

  const pushTrace = (traceCode: ConversationSupervisorTraceCode) => {
    if (!traceCodes.includes(traceCode)) {
      traceCodes.push(traceCode);
    }
  };

  if (summary.multimodalAuthority === 'low_authority') {
    pushTrace('multimodal_degraded');
    addAction(actions, {
      type: 'treat_multimodal_as_low_authority',
      target: 'multimodal',
      priority: 'high',
      rationale: 'Recent media analysis is degraded, so treat media as a hint rather than evidentiary grounding.',
    }, maxRecommendations);
  } else if (multimodalDiagnostics?.status === 'error') {
    pushTrace('multimodal_error');
    addAction(actions, {
      type: 'treat_multimodal_as_low_authority',
      target: 'multimodal',
      priority: 'medium',
      rationale: 'Multimodal analysis failed on the latest cycle. Keep media context available, but do not treat it as authoritative.',
    }, maxRecommendations);
  }

  if (writerDiagnostics?.status === 'error') {
    pushTrace('writer_error');
    addAction(actions, {
      type: 'rerun_writer_with_safe_fallback',
      target: 'writer',
      priority: 'high',
      rationale: 'The writer failed after canonical thread state resolved. A constrained rerun or safe fallback is the next safest move.',
    }, maxRecommendations);
  } else if ((writerDiagnostics?.staleDiscardCount ?? 0) > 0) {
    pushTrace('writer_stale_discard');
  }

  if (summary.hasMutationChurn && (
    summary.activeTasks.length > 0
    || (writerDiagnostics?.staleDiscardCount ?? 0) > 0
  )) {
    pushTrace('mutation_churn');
    addAction(actions, {
      type: 'stabilize_composer_context',
      target: 'composer',
      priority: 'medium',
      rationale: 'Thread mutations are racing active model work. Stabilize composer context before reusing guidance or rerunning generation.',
    }, maxRecommendations);
  }

  if (summary.premiumStatus === 'loading' && summary.hasMutationChurn) {
    pushTrace('premium_waiting_on_freshness');
    addAction(actions, {
      type: 'hold_premium_until_fresh',
      target: 'premium',
      priority: 'medium',
      rationale: 'Premium deep synthesis is running while the thread is still moving. Wait for a fresher canonical state before trusting the result.',
    }, maxRecommendations);
  }

  if (summary.premiumStatus === 'error' || premiumDiagnostics?.status === 'error') {
    pushTrace('premium_error');
    if (!summary.didMeaningfullyChange || summary.summaryMode === 'minimal_fallback') {
      pushTrace('premium_low_signal_cycle');
      addAction(actions, {
        type: 'skip_premium_for_cycle',
        target: 'premium',
        priority: 'medium',
        rationale: 'Premium deep failed on a low-signal cycle. Skip another premium attempt until the thread meaningfully changes.',
      }, maxRecommendations);
    } else {
      addAction(actions, {
        type: 'hold_premium_until_fresh',
        target: 'premium',
        priority: 'medium',
        rationale: 'Premium deep failed on an active thread. Wait for a fresh canonical state before retrying the remote pass.',
      }, maxRecommendations);
    }
  }

  return { actions, traceCodes };
}

function buildFingerprint(params: {
  summary: ConversationSupervisorStateSummary;
  actions: ConversationSupervisorAction[];
  traceCodes: ConversationSupervisorTraceCode[];
}): string {
  const { summary, actions, traceCodes } = params;
  return JSON.stringify({
    summaryMode: summary.summaryMode,
    didMeaningfullyChange: summary.didMeaningfullyChange,
    changeMagnitude: Number(summary.changeMagnitude.toFixed(3)),
    activeTasks: summary.activeTasks,
    errorTasks: summary.errorTasks,
    premiumStatus: summary.premiumStatus,
    multimodalAuthority: summary.multimodalAuthority,
    hasMutationChurn: summary.hasMutationChurn,
    actions: actions.map((action) => action.type),
    traceCodes,
  });
}

export function applyShadowConversationSupervisor(
  session: ConversationSession,
  trigger: ConversationSupervisorTrigger,
  options?: {
    evaluatedAt?: string;
    cooldownMs?: number;
    maxRecommendations?: number;
  },
): ConversationSession {
  try {
    const evaluatedAt = toIsoTimestamp(options?.evaluatedAt) ?? new Date().toISOString();
    const cooldownMs = options?.cooldownMs ?? DEFAULT_SUPERVISOR_COOLDOWN_MS;
    const maxRecommendations = options?.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;
    const current = session.interpretation.supervisor ?? createEmptySupervisorState();
    const summary = buildStateSummary(session);
    const { actions, traceCodes } = buildRecommendations({
      session,
      trigger,
      summary,
      maxRecommendations,
    });
    const fingerprint = buildFingerprint({ summary, actions, traceCodes });
    const lastDecision = current.lastDecision;
    const lastEvaluatedMs = lastDecision ? Date.parse(lastDecision.evaluatedAt) : Number.NaN;
    const currentEvaluatedMs = Date.parse(evaluatedAt);
    const cooldownSuppressed = Boolean(
      lastDecision
      && lastDecision.fingerprint === fingerprint
      && Number.isFinite(lastEvaluatedMs)
      && Number.isFinite(currentEvaluatedMs)
      && (currentEvaluatedMs - lastEvaluatedMs) < cooldownMs
    );

    recordConversationSupervisorDecision({
      trigger,
      actionTypes: actions.map((action) => action.type),
      traceCodes,
      evaluatedAt,
      summaryMode: summary.summaryMode,
      activeTasks: summary.activeTasks,
      premiumStatus: summary.premiumStatus,
      multimodalAuthority: summary.multimodalAuthority,
      cooldownSuppressed,
    });

    const baseState: ConversationSupervisorState = {
      ...current,
      mode: 'shadow',
      decisionsEvaluated: current.decisionsEvaluated + 1,
      lastEvaluatedAt: evaluatedAt,
      cooldownSuppressions: current.cooldownSuppressions + (cooldownSuppressed ? 1 : 0),
      recommendationsIssued: current.recommendationsIssued + (cooldownSuppressed ? 0 : actions.length),
    };

    if (cooldownSuppressed) {
      return {
        ...session,
        interpretation: {
          ...session.interpretation,
          supervisor: baseState,
        },
      };
    }

    const decision: ConversationSupervisorDecision = {
      mode: 'shadow',
      trigger,
      evaluatedAt,
      fingerprint,
      traceCodes,
      actions,
      stateSummary: summary,
    };

    return {
      ...session,
      interpretation: {
        ...session.interpretation,
        supervisor: {
          ...baseState,
          currentRecommendations: actions,
          lastDecision: decision,
        },
      },
    };
  } catch {
    return session;
  }
}

export function createConversationSupervisorState(): ConversationSupervisorState {
  return createEmptySupervisorState();
}

/**
 * Async wrapper that runs the synchronous shadow supervisor and then the
 * bounded next-step planner thinking lane. The session shape is unchanged;
 * the planner output is returned alongside so live router/coordinator surfaces
 * can act on a single deterministic next-step decision.
 *
 * - Existing callers that import {@link applyShadowConversationSupervisor}
 *   keep byte-identical behaviour and decision shape.
 * - Planner failures fall back to a defensible plan (preserves caller behaviour);
 *   never throws.
 */
export async function evaluateConversationSupervisorWithPlanner(
  session: ConversationSession,
  trigger: ConversationSupervisorTrigger,
  options?: {
    evaluatedAt?: string;
    cooldownMs?: number;
    maxRecommendations?: number;
    signal?: AbortSignal;
  },
): Promise<{
  session: ConversationSession;
  plan: import('./supervisorNextStepPlanner').SupervisorNextStepPlan;
}> {
  const applyOptions: {
    evaluatedAt?: string;
    cooldownMs?: number;
    maxRecommendations?: number;
  } = {};
  if (options?.evaluatedAt !== undefined) applyOptions.evaluatedAt = options.evaluatedAt;
  if (options?.cooldownMs !== undefined) applyOptions.cooldownMs = options.cooldownMs;
  if (options?.maxRecommendations !== undefined) applyOptions.maxRecommendations = options.maxRecommendations;

  const nextSession = applyShadowConversationSupervisor(session, trigger, applyOptions);
  const decision = nextSession.interpretation.supervisor?.lastDecision ?? null;

  // Lazy import keeps the synchronous code path free of the planner module.
  const { planSupervisorNextStep } = await import('./supervisorNextStepPlanner');

  if (!decision) {
    const planResult = await planSupervisorNextStep(
      {
        summary: buildStateSummary(nextSession),
        baseActions: [],
        traceCodes: [],
      },
      options?.signal ? { signal: options.signal } : {},
    );
    return { session: nextSession, plan: planResult.plan };
  }

  const planResult = await planSupervisorNextStep(
    {
      summary: decision.stateSummary,
      baseActions: decision.actions,
      traceCodes: decision.traceCodes,
    },
    options?.signal ? { signal: options.signal } : {},
  );
  return { session: nextSession, plan: planResult.plan };
}
