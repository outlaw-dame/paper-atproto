import type { ConfidenceState, SummaryMode } from '../intelligence/llmContracts';

export type ConversationSupervisorMode = 'shadow';

export type ConversationSupervisorTrigger =
  | 'session_hydrated'
  | 'writer_completed'
  | 'multimodal_completed'
  | 'premium_completed';

export type ConversationSupervisorActionType =
  | 'hold_premium_until_fresh'
  | 'rerun_writer_with_safe_fallback'
  | 'skip_premium_for_cycle'
  | 'stabilize_composer_context'
  | 'treat_multimodal_as_low_authority';

export type ConversationSupervisorActionTarget =
  | 'writer'
  | 'multimodal'
  | 'premium'
  | 'composer';

export type ConversationSupervisorActionPriority = 'high' | 'medium' | 'low';

export type ConversationSupervisorTraceCode =
  | 'writer_error'
  | 'writer_stale_discard'
  | 'multimodal_degraded'
  | 'multimodal_error'
  | 'premium_error'
  | 'premium_low_signal_cycle'
  | 'mutation_churn'
  | 'premium_waiting_on_freshness';

export interface ConversationSupervisorAction {
  type: ConversationSupervisorActionType;
  target: ConversationSupervisorActionTarget;
  priority: ConversationSupervisorActionPriority;
  rationale: string;
}

export interface ConversationSupervisorStateSummary {
  summaryMode: SummaryMode | null;
  confidence: ConfidenceState | null;
  didMeaningfullyChange: boolean;
  changeMagnitude: number;
  activeTasks: Array<'writer' | 'multimodal' | 'premium'>;
  errorTasks: Array<'writer' | 'multimodal' | 'premium'>;
  premiumStatus: 'idle' | 'loading' | 'ready' | 'error' | 'not_entitled';
  multimodalAuthority: 'none' | 'authoritative' | 'low_authority';
  hasMutationChurn: boolean;
  mutationRevision: number;
}

export interface ConversationSupervisorDecision {
  mode: ConversationSupervisorMode;
  trigger: ConversationSupervisorTrigger;
  evaluatedAt: string;
  fingerprint: string;
  traceCodes: ConversationSupervisorTraceCode[];
  actions: ConversationSupervisorAction[];
  stateSummary: ConversationSupervisorStateSummary;
}

export interface ConversationSupervisorState {
  mode: ConversationSupervisorMode;
  decisionsEvaluated: number;
  recommendationsIssued: number;
  cooldownSuppressions: number;
  lastEvaluatedAt?: string;
  currentRecommendations: ConversationSupervisorAction[];
  lastDecision: ConversationSupervisorDecision | null;
}
