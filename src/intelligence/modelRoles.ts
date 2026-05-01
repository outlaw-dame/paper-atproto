export type IntelligenceModelRole =
  | 'router'
  | 'coordinator'
  | 'interpolator_writer'
  | 'writer_enhancer'
  | 'media_observer'
  | 'media_verifier'
  | 'embedder'
  | 'classifier'
  | 'reranker'
  | 'entity_linker'
  | 'fact_check_enricher';

export type IntelligenceComponentRole =
  | IntelligenceModelRole
  | 'entity_cache'
  | 'coverage_gap'
  | 'projection';

export type IntelligenceComponentState =
  | 'not_needed'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'degraded'
  | 'failed'
  | 'stale'
  | 'blocked';

export type IntelligenceComponentQuality =
  | 'unknown'
  | 'insufficient'
  | 'acceptable'
  | 'strong';

export type CoordinatorReasonCode =
  | 'component_not_needed'
  | 'component_ready'
  | 'component_running'
  | 'component_succeeded'
  | 'component_degraded'
  | 'component_failed'
  | 'component_stale'
  | 'component_blocked_by_privacy'
  | 'component_blocked_by_policy'
  | 'source_token_mismatch'
  | 'provider_unavailable'
  | 'fallback_available'
  | 'fallback_unavailable'
  | 'quality_below_threshold'
  | 'coverage_gap_detected'
  | 'remote_execution_blocked'
  | 'local_execution_preferred';

export type CoordinatorAction =
  | 'keep_current_projection'
  | 'request_review'
  | 'retry_component'
  | 'switch_writer_model'
  | 'invoke_writer_enhancer'
  | 'downgrade_summary_mode'
  | 'trigger_media_observation'
  | 'pause_expensive_projection';

export interface IntelligenceComponentStatus {
  role: IntelligenceComponentRole;
  state: IntelligenceComponentState;
  quality: IntelligenceComponentQuality;
  reasonCodes: CoordinatorReasonCode[];
  recommendedActions: CoordinatorAction[];
  updatedAtMs: number;
}

export type IntelligenceComponentStatusInput = Omit<
  IntelligenceComponentStatus,
  'updatedAtMs' | 'reasonCodes' | 'recommendedActions'
> & {
  updatedAtMs?: number;
  reasonCodes?: CoordinatorReasonCode[];
  recommendedActions?: CoordinatorAction[];
};

export function createIntelligenceComponentStatus(
  status: IntelligenceComponentStatusInput,
): IntelligenceComponentStatus {
  return {
    ...status,
    reasonCodes: Array.from(new Set(status.reasonCodes ?? [])),
    recommendedActions: Array.from(new Set(status.recommendedActions ?? [])),
    updatedAtMs: status.updatedAtMs ?? Date.now(),
  };
}
