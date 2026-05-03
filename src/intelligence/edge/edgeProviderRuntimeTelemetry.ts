import type { EdgeCapability } from './edgeProviderContracts';

export type EdgeRuntimeFailureReason =
  | 'capability_mismatch'
  | 'capability_unsupported'
  | 'provider_mismatch'
  | 'provider_unsupported'
  | 'provider_execution_error'
  | 'endpoint_http_error'
  | 'endpoint_non_json'
  | 'endpoint_network_error'
  | 'endpoint_abort';

type EdgeCapabilityCounters = Record<EdgeCapability, number>;

export interface EdgeRuntimeTelemetrySnapshot {
  attemptedByCapability: EdgeCapabilityCounters;
  succeededByCapability: EdgeCapabilityCounters;
  failedByCapability: EdgeCapabilityCounters;
  failureReasons: Record<EdgeRuntimeFailureReason, number>;
}

const ZERO_CAPABILITY_COUNTERS: EdgeCapabilityCounters = {
  composer_classify: 0,
  search_rerank: 0,
  media_classify: 0,
  story_summarize: 0,
};

const ZERO_FAILURE_REASONS: Record<EdgeRuntimeFailureReason, number> = {
  capability_mismatch: 0,
  capability_unsupported: 0,
  provider_mismatch: 0,
  provider_unsupported: 0,
  provider_execution_error: 0,
  endpoint_http_error: 0,
  endpoint_non_json: 0,
  endpoint_network_error: 0,
  endpoint_abort: 0,
};

const telemetry: EdgeRuntimeTelemetrySnapshot = {
  attemptedByCapability: { ...ZERO_CAPABILITY_COUNTERS },
  succeededByCapability: { ...ZERO_CAPABILITY_COUNTERS },
  failedByCapability: { ...ZERO_CAPABILITY_COUNTERS },
  failureReasons: { ...ZERO_FAILURE_REASONS },
};

export function recordEdgeRuntimeAttempt(capability: EdgeCapability): void {
  telemetry.attemptedByCapability[capability] += 1;
}

export function recordEdgeRuntimeSuccess(capability: EdgeCapability): void {
  telemetry.succeededByCapability[capability] += 1;
}

export function recordEdgeRuntimeFailure(
  capability: EdgeCapability,
  reason: EdgeRuntimeFailureReason,
): void {
  telemetry.failedByCapability[capability] += 1;
  telemetry.failureReasons[reason] += 1;
}

export function getEdgeRuntimeTelemetrySnapshot(): EdgeRuntimeTelemetrySnapshot {
  return {
    attemptedByCapability: { ...telemetry.attemptedByCapability },
    succeededByCapability: { ...telemetry.succeededByCapability },
    failedByCapability: { ...telemetry.failedByCapability },
    failureReasons: { ...telemetry.failureReasons },
  };
}

export function resetEdgeRuntimeTelemetry(): void {
  telemetry.attemptedByCapability = { ...ZERO_CAPABILITY_COUNTERS };
  telemetry.succeededByCapability = { ...ZERO_CAPABILITY_COUNTERS };
  telemetry.failedByCapability = { ...ZERO_CAPABILITY_COUNTERS };
  telemetry.failureReasons = { ...ZERO_FAILURE_REASONS };
}