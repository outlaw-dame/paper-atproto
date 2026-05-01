import type {
  ConversationModelRunDiagnostics,
  ConversationModelRunStatus,
  ConversationSession,
  ConversationSessionId,
  ConversationSessionMode,
  SessionAiDiagnostics,
} from './sessionTypes';
import { readSessionAiDiagnostics } from './modelExecution';
import { buildConversationModelSourceToken } from './modelSourceToken';

export const CONVERSATION_COORDINATOR_CONTEXT_VERSION = 1 as const;

export type ConversationCoordinatorStage =
  | 'canonical_session'
  | 'writer'
  | 'multimodal'
  | 'premium';

export type ConversationCoordinatorDecisionAction =
  | 'continue'
  | 'wait_for_session'
  | 'wait_for_active_model_stage'
  | 'review_model_errors';

export type ConversationCoordinatorReasonCode =
  | 'canonical_session_idle'
  | 'canonical_session_loading'
  | 'canonical_session_ready'
  | 'canonical_session_error'
  | 'source_token_available'
  | 'source_token_missing'
  | 'mutation_churn_present'
  | 'summary_minimal_fallback'
  | 'writer_result_present'
  | 'media_findings_present'
  | 'premium_not_entitled'
  | 'writer_loading'
  | 'multimodal_loading'
  | 'premium_loading'
  | 'writer_error'
  | 'multimodal_error'
  | 'premium_error'
  | 'writer_stale_discard'
  | 'multimodal_stale_discard'
  | 'premium_stale_discard';

export interface ConversationCoordinatorStageSnapshot {
  stage: Exclude<ConversationCoordinatorStage, 'canonical_session'>;
  provider: ConversationModelRunDiagnostics['provider'];
  status: ConversationModelRunStatus;
  sourceToken?: string;
  lastRequestedAt?: string;
  lastCompletedAt?: string;
  lastDurationMs?: number;
  lastError?: string;
  lastSkipReason?: ConversationModelRunDiagnostics['lastSkipReason'];
  staleDiscardCount: number;
  lastDiscardedAt?: string;
  hasStaleDiscards: boolean;
}

export interface ConversationCoordinatorContextSnapshot {
  schemaVersion: typeof CONVERSATION_COORDINATOR_CONTEXT_VERSION;
  sessionId: ConversationSessionId;
  rootUri: string;
  mode: ConversationSessionMode;
  metaStatus: ConversationSession['meta']['status'];
  metaError?: string | null;
  sourceToken: string | null;
  mutationRevision: number;
  lastMutationAt?: string;
  lastHydratedAt?: string;
  lastComputedAt?: string;
  summaryMode: ConversationSession['interpretation']['summaryMode'];
  didMeaningfullyChange: boolean;
  premiumStatus: ConversationSession['interpretation']['premium']['status'];
  modelStages: Record<Exclude<ConversationCoordinatorStage, 'canonical_session'>, ConversationCoordinatorStageSnapshot>;
  activeStages: Array<Exclude<ConversationCoordinatorStage, 'canonical_session'>>;
  errorStages: Array<Exclude<ConversationCoordinatorStage, 'canonical_session'>>;
  staleStages: Array<Exclude<ConversationCoordinatorStage, 'canonical_session'>>;
  hasMutationChurn: boolean;
  reasonCodes: ConversationCoordinatorReasonCode[];
}

export interface ConversationCoordinatorDecision {
  action: ConversationCoordinatorDecisionAction;
  final: boolean;
  reasonCodes: ConversationCoordinatorReasonCode[];
  activeStages: ConversationCoordinatorContextSnapshot['activeStages'];
  errorStages: ConversationCoordinatorContextSnapshot['errorStages'];
  staleStages: ConversationCoordinatorContextSnapshot['staleStages'];
}

const MODEL_STAGES = ['writer', 'multimodal', 'premium'] as const;

type ModelStage = typeof MODEL_STAGES[number];

export function createConversationCoordinatorContextSnapshot(
  session: ConversationSession,
): ConversationCoordinatorContextSnapshot {
  const diagnostics = readSessionAiDiagnostics(session);
  const modelStages = createModelStageSnapshots(diagnostics);
  const activeStages = MODEL_STAGES.filter((stage) => modelStages[stage].status === 'loading');
  const errorStages = MODEL_STAGES.filter((stage) => modelStages[stage].status === 'error');
  const staleStages = MODEL_STAGES.filter((stage) => modelStages[stage].hasStaleDiscards);
  const sourceToken = buildSafeSourceToken(session);
  const hasMutationChurn = detectMutationChurn(session);
  const reasonCodes = createReasonCodes({
    session,
    sourceToken,
    modelStages,
    activeStages,
    errorStages,
    staleStages,
    hasMutationChurn,
  });

  return {
    schemaVersion: CONVERSATION_COORDINATOR_CONTEXT_VERSION,
    sessionId: session.id,
    rootUri: session.graph.rootUri,
    mode: session.mode,
    metaStatus: session.meta.status,
    ...(session.meta.error !== undefined ? { metaError: session.meta.error } : {}),
    sourceToken,
    mutationRevision: session.mutations.revision,
    ...(session.mutations.lastMutationAt ? { lastMutationAt: session.mutations.lastMutationAt } : {}),
    ...(session.meta.lastHydratedAt ? { lastHydratedAt: session.meta.lastHydratedAt } : {}),
    ...(session.interpretation.lastComputedAt ? { lastComputedAt: session.interpretation.lastComputedAt } : {}),
    summaryMode: session.interpretation.summaryMode,
    didMeaningfullyChange: Boolean(session.interpretation.deltaDecision?.didMeaningfullyChange),
    premiumStatus: session.interpretation.premium.status,
    modelStages,
    activeStages,
    errorStages,
    staleStages,
    hasMutationChurn,
    reasonCodes,
  };
}

export function selectConversationCoordinatorDecision(
  context: ConversationCoordinatorContextSnapshot,
): ConversationCoordinatorDecision {
  if (context.metaStatus === 'idle' || context.metaStatus === 'loading') {
    return buildDecision({
      action: 'wait_for_session',
      final: false,
      context,
      reasonCodes: context.metaStatus === 'idle'
        ? ['canonical_session_idle']
        : ['canonical_session_loading'],
    });
  }

  if (context.metaStatus === 'error' || context.errorStages.length > 0) {
    return buildDecision({
      action: 'review_model_errors',
      final: true,
      context,
      reasonCodes: [
        ...(context.metaStatus === 'error' ? ['canonical_session_error' as const] : []),
        ...context.errorStages.map((stage) => `${stage}_error` as ConversationCoordinatorReasonCode),
      ],
    });
  }

  if (context.activeStages.length > 0) {
    return buildDecision({
      action: 'wait_for_active_model_stage',
      final: false,
      context,
      reasonCodes: context.activeStages.map((stage) => `${stage}_loading` as ConversationCoordinatorReasonCode),
    });
  }

  return buildDecision({
    action: 'continue',
    final: false,
    context,
    reasonCodes: ['canonical_session_ready'],
  });
}

function createModelStageSnapshots(
  diagnostics: SessionAiDiagnostics,
): ConversationCoordinatorContextSnapshot['modelStages'] {
  return {
    writer: createStageSnapshot('writer', diagnostics.writer),
    multimodal: createStageSnapshot('multimodal', diagnostics.multimodal),
    premium: createStageSnapshot('premium', diagnostics.premium),
  };
}

function createStageSnapshot(
  stage: ModelStage,
  diagnostics: ConversationModelRunDiagnostics,
): ConversationCoordinatorStageSnapshot {
  return {
    stage,
    provider: diagnostics.provider,
    status: diagnostics.status,
    ...(diagnostics.sourceToken ? { sourceToken: diagnostics.sourceToken } : {}),
    ...(diagnostics.lastRequestedAt ? { lastRequestedAt: diagnostics.lastRequestedAt } : {}),
    ...(diagnostics.lastCompletedAt ? { lastCompletedAt: diagnostics.lastCompletedAt } : {}),
    ...(diagnostics.lastDurationMs !== undefined ? { lastDurationMs: diagnostics.lastDurationMs } : {}),
    ...(diagnostics.lastError ? { lastError: diagnostics.lastError } : {}),
    ...(diagnostics.lastSkipReason ? { lastSkipReason: diagnostics.lastSkipReason } : {}),
    staleDiscardCount: diagnostics.staleDiscardCount,
    ...(diagnostics.lastDiscardedAt ? { lastDiscardedAt: diagnostics.lastDiscardedAt } : {}),
    hasStaleDiscards: diagnostics.staleDiscardCount > 0,
  };
}

function createReasonCodes(params: {
  session: ConversationSession;
  sourceToken: string | null;
  modelStages: ConversationCoordinatorContextSnapshot['modelStages'];
  activeStages: ConversationCoordinatorContextSnapshot['activeStages'];
  errorStages: ConversationCoordinatorContextSnapshot['errorStages'];
  staleStages: ConversationCoordinatorContextSnapshot['staleStages'];
  hasMutationChurn: boolean;
}): ConversationCoordinatorReasonCode[] {
  const reasonCodes: ConversationCoordinatorReasonCode[] = [];
  const { session } = params;

  if (session.meta.status === 'idle') reasonCodes.push('canonical_session_idle');
  if (session.meta.status === 'loading') reasonCodes.push('canonical_session_loading');
  if (session.meta.status === 'ready') reasonCodes.push('canonical_session_ready');
  if (session.meta.status === 'error') reasonCodes.push('canonical_session_error');

  reasonCodes.push(params.sourceToken ? 'source_token_available' : 'source_token_missing');

  if (params.hasMutationChurn) reasonCodes.push('mutation_churn_present');
  if (session.interpretation.summaryMode === 'minimal_fallback') reasonCodes.push('summary_minimal_fallback');
  if (session.interpretation.writerResult?.collapsedSummary?.trim()) reasonCodes.push('writer_result_present');
  if ((session.interpretation.mediaFindings?.length ?? 0) > 0) reasonCodes.push('media_findings_present');
  if (session.interpretation.premium.status === 'not_entitled') reasonCodes.push('premium_not_entitled');

  for (const stage of params.activeStages) {
    reasonCodes.push(`${stage}_loading` as ConversationCoordinatorReasonCode);
  }
  for (const stage of params.errorStages) {
    reasonCodes.push(`${stage}_error` as ConversationCoordinatorReasonCode);
  }
  for (const stage of params.staleStages) {
    reasonCodes.push(`${stage}_stale_discard` as ConversationCoordinatorReasonCode);
  }

  return unique(reasonCodes);
}

function buildDecision(params: {
  action: ConversationCoordinatorDecisionAction;
  final: boolean;
  context: ConversationCoordinatorContextSnapshot;
  reasonCodes: ConversationCoordinatorReasonCode[];
}): ConversationCoordinatorDecision {
  return {
    action: params.action,
    final: params.final,
    reasonCodes: unique(params.reasonCodes),
    activeStages: params.context.activeStages,
    errorStages: params.context.errorStages,
    staleStages: params.context.staleStages,
  };
}

function buildSafeSourceToken(session: ConversationSession): string | null {
  try {
    const token = buildConversationModelSourceToken(session).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function detectMutationChurn(session: ConversationSession): boolean {
  const mutationMs = parseIsoMs(session.mutations.lastMutationAt);
  if (mutationMs === null) return false;
  const hydratedMs = parseIsoMs(session.meta.lastHydratedAt);
  return hydratedMs === null || mutationMs > hydratedMs;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
