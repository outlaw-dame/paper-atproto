import type {
  ConversationSupervisorActionType,
  ConversationSupervisorTraceCode,
  ConversationSupervisorTrigger,
} from '../conversation/supervisorTypes';

export interface ConversationSupervisorTelemetrySnapshot {
  mode: 'shadow';
  decisionsEvaluated: number;
  noActionDecisions: number;
  recommendationsIssued: number;
  cooldownSuppressions: number;
  triggerCounts: Record<ConversationSupervisorTrigger, number>;
  actionCounts: Record<ConversationSupervisorActionType, number>;
  traceCounts: Record<ConversationSupervisorTraceCode, number>;
  lastDecision: {
    trigger: ConversationSupervisorTrigger;
    evaluatedAt: string;
    actionTypes: ConversationSupervisorActionType[];
    traceCodes: ConversationSupervisorTraceCode[];
    summaryMode: string | null;
    activeTasks: string[];
    premiumStatus: string;
    multimodalAuthority: 'none' | 'authoritative' | 'low_authority';
    cooldownSuppressed: boolean;
  } | null;
}

const CONVERSATION_SUPERVISOR_EVENT = 'glympse:conversation-supervisor-metrics';

const TRIGGER_KEYS: ConversationSupervisorTrigger[] = [
  'session_hydrated',
  'writer_completed',
  'multimodal_completed',
  'premium_completed',
];

const ACTION_KEYS: ConversationSupervisorActionType[] = [
  'hold_premium_until_fresh',
  'rerun_writer_with_safe_fallback',
  'skip_premium_for_cycle',
  'stabilize_composer_context',
  'treat_multimodal_as_low_authority',
];

const TRACE_KEYS: ConversationSupervisorTraceCode[] = [
  'writer_error',
  'writer_stale_discard',
  'multimodal_degraded',
  'multimodal_error',
  'premium_error',
  'premium_low_signal_cycle',
  'mutation_churn',
  'premium_waiting_on_freshness',
];

function zeroRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

const state = {
  decisionsEvaluated: 0,
  noActionDecisions: 0,
  recommendationsIssued: 0,
  cooldownSuppressions: 0,
  triggerCounts: zeroRecord(TRIGGER_KEYS),
  actionCounts: zeroRecord(ACTION_KEYS),
  traceCounts: zeroRecord(TRACE_KEYS),
  lastDecision: null as ConversationSupervisorTelemetrySnapshot['lastDecision'],
};

function sanitizeIsoTimestamp(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function publish(): void {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = getConversationSupervisorTelemetrySnapshot();
    (
      window as Window & {
        __GLYMPSE_CONVERSATION_SUPERVISOR__?: ConversationSupervisorTelemetrySnapshot;
      }
    ).__GLYMPSE_CONVERSATION_SUPERVISOR__ = snapshot;
    window.dispatchEvent(new CustomEvent<ConversationSupervisorTelemetrySnapshot>(
      CONVERSATION_SUPERVISOR_EVENT,
      { detail: snapshot },
    ));
  } catch {
    // best-effort only
  }
}

export function recordConversationSupervisorDecision(params: {
  trigger: ConversationSupervisorTrigger;
  actionTypes: ConversationSupervisorActionType[];
  traceCodes: ConversationSupervisorTraceCode[];
  evaluatedAt?: string;
  summaryMode?: string | null;
  activeTasks?: string[];
  premiumStatus?: string;
  multimodalAuthority?: 'none' | 'authoritative' | 'low_authority';
  cooldownSuppressed?: boolean;
}): void {
  try {
    state.decisionsEvaluated += 1;
    state.triggerCounts[params.trigger] += 1;

    if (params.cooldownSuppressed) {
      state.cooldownSuppressions += 1;
    }

    if (params.actionTypes.length === 0) {
      state.noActionDecisions += 1;
    }

    for (const actionType of params.actionTypes) {
      state.actionCounts[actionType] += 1;
      state.recommendationsIssued += 1;
    }

    for (const traceCode of params.traceCodes) {
      state.traceCounts[traceCode] += 1;
    }

    state.lastDecision = {
      trigger: params.trigger,
      evaluatedAt: sanitizeIsoTimestamp(params.evaluatedAt),
      actionTypes: [...params.actionTypes],
      traceCodes: [...params.traceCodes],
      summaryMode: params.summaryMode ?? null,
      activeTasks: [...(params.activeTasks ?? [])].slice(0, 3),
      premiumStatus: typeof params.premiumStatus === 'string'
        ? params.premiumStatus.slice(0, 24)
        : 'idle',
      multimodalAuthority: params.multimodalAuthority ?? 'none',
      cooldownSuppressed: Boolean(params.cooldownSuppressed),
    };

    publish();
  } catch {
    // best-effort only
  }
}

export function getConversationSupervisorTelemetrySnapshot(): ConversationSupervisorTelemetrySnapshot {
  return {
    mode: 'shadow',
    decisionsEvaluated: state.decisionsEvaluated,
    noActionDecisions: state.noActionDecisions,
    recommendationsIssued: state.recommendationsIssued,
    cooldownSuppressions: state.cooldownSuppressions,
    triggerCounts: { ...state.triggerCounts },
    actionCounts: { ...state.actionCounts },
    traceCounts: { ...state.traceCounts },
    lastDecision: state.lastDecision
      ? {
          ...state.lastDecision,
          actionTypes: [...state.lastDecision.actionTypes],
          traceCodes: [...state.lastDecision.traceCodes],
          activeTasks: [...state.lastDecision.activeTasks],
        }
      : null,
  };
}

export function subscribeConversationSupervisorTelemetry(
  listener: (snapshot: ConversationSupervisorTelemetrySnapshot) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<ConversationSupervisorTelemetrySnapshot>;
    listener(customEvent.detail ?? getConversationSupervisorTelemetrySnapshot());
  };

  window.addEventListener(CONVERSATION_SUPERVISOR_EVENT, handler as EventListener);

  try {
    listener(
      (
        window as Window & {
          __GLYMPSE_CONVERSATION_SUPERVISOR__?: ConversationSupervisorTelemetrySnapshot;
        }
      ).__GLYMPSE_CONVERSATION_SUPERVISOR__ ?? getConversationSupervisorTelemetrySnapshot(),
    );
  } catch {
    // listener errors are user-land
  }

  return () => {
    window.removeEventListener(CONVERSATION_SUPERVISOR_EVENT, handler as EventListener);
  };
}

export function resetConversationSupervisorTelemetryForTests(): void {
  state.decisionsEvaluated = 0;
  state.noActionDecisions = 0;
  state.recommendationsIssued = 0;
  state.cooldownSuppressions = 0;
  state.triggerCounts = zeroRecord(TRIGGER_KEYS);
  state.actionCounts = zeroRecord(ACTION_KEYS);
  state.traceCounts = zeroRecord(TRACE_KEYS);
  state.lastDecision = null;
}
