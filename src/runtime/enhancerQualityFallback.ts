import type {
  CoordinationContract,
  CoordinationReasonCode,
  CoordinationRouteId,
  CoordinationRouteOption,
} from './routerCoordinatorContract';

export type EnhancerExecutionStatus =
  | 'not_started'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'quality_below_threshold'
  | 'stale_result';

export type EnhancerFallbackAction =
  | 'accept_current'
  | 'retry_same_route'
  | 'fallback_route'
  | 'deterministic_only'
  | 'flag_for_review';

export type EnhancerFallbackReason =
  | 'quality_acceptable'
  | 'quality_below_threshold'
  | 'transient_failure'
  | 'timeout'
  | 'stale_result'
  | 'retry_budget_exhausted'
  | 'fallback_unavailable'
  | 'policy_violation';

export interface EnhancerQualityThresholds {
  minimumQualityScore: number;
  retryableQualityFloor: number;
  staleAfterMs: number;
  maxRetries: 0 | 1;
}

export interface EnhancerExecutionSnapshot {
  status: EnhancerExecutionStatus;
  routeId: CoordinationRouteId;
  qualityScore: number | null;
  startedAtEpochMs: number;
  completedAtEpochMs: number | null;
  attempts: number;
  errorKind?: 'none' | 'model_error' | 'timeout' | 'policy_violation' | 'unknown';
}

export interface EnhancerFallbackDecision {
  schemaVersion: 1;
  action: EnhancerFallbackAction;
  reason: EnhancerFallbackReason;
  selectedRoute: CoordinationRouteOption;
  selectedRouteId: CoordinationRouteId;
  retryAllowed: boolean;
  reasonCodes: CoordinationReasonCode[];
  diagnostics: {
    qualityScore: number | null;
    minimumQualityScore: number;
    retryableQualityFloor: number;
    attempts: number;
    maxRetries: 0 | 1;
    stale: boolean;
  };
}

export const DEFAULT_ENHANCER_QUALITY_THRESHOLDS: EnhancerQualityThresholds = {
  minimumQualityScore: 0.72,
  retryableQualityFloor: 0.45,
  staleAfterMs: 15_000,
  maxRetries: 1,
};

function clampQualityScore(score: number | null): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(1, score));
}

function selectAllowedRoute(
  contract: CoordinationContract,
  routeId: CoordinationRouteId,
): CoordinationRouteOption | null {
  return contract.allowedRoutes.find((route) => route.id === routeId && route.allowed) ?? null;
}

function selectSafeFallbackRoute(contract: CoordinationContract): CoordinationRouteOption {
  const fallback = selectAllowedRoute(contract, contract.fallbackRouteId)
    ?? selectAllowedRoute(contract, contract.defaultRouteId)
    ?? contract.allowedRoutes.find((route) => route.allowed)
    ?? contract.allowedRoutes[0];

  if (!fallback) {
    throw new Error('CoordinationContract invariant violated: allowedRoutes must be non-empty');
  }
  return fallback;
}

function buildDecision(params: {
  action: EnhancerFallbackAction;
  reason: EnhancerFallbackReason;
  selectedRoute: CoordinationRouteOption;
  snapshot: EnhancerExecutionSnapshot;
  thresholds: EnhancerQualityThresholds;
  stale: boolean;
  retryAllowed: boolean;
  reasonCodes?: CoordinationReasonCode[];
}): EnhancerFallbackDecision {
  const qualityScore = clampQualityScore(params.snapshot.qualityScore);
  return {
    schemaVersion: 1,
    action: params.action,
    reason: params.reason,
    selectedRoute: params.selectedRoute,
    selectedRouteId: params.selectedRoute.id,
    retryAllowed: params.retryAllowed,
    reasonCodes: params.reasonCodes ?? params.selectedRoute.reasonCodes,
    diagnostics: {
      qualityScore,
      minimumQualityScore: params.thresholds.minimumQualityScore,
      retryableQualityFloor: params.thresholds.retryableQualityFloor,
      attempts: params.snapshot.attempts,
      maxRetries: params.thresholds.maxRetries,
      stale: params.stale,
    },
  };
}

function canRetry(snapshot: EnhancerExecutionSnapshot, thresholds: EnhancerQualityThresholds): boolean {
  return snapshot.attempts <= thresholds.maxRetries;
}

export function decideEnhancerQualityFallback(params: {
  contract: CoordinationContract;
  snapshot: EnhancerExecutionSnapshot;
  thresholds?: Partial<EnhancerQualityThresholds>;
  nowEpochMs?: number;
}): EnhancerFallbackDecision {
  const thresholds: EnhancerQualityThresholds = {
    ...DEFAULT_ENHANCER_QUALITY_THRESHOLDS,
    ...params.thresholds,
  };
  const nowEpochMs = Number.isFinite(params.nowEpochMs) ? Number(params.nowEpochMs) : Date.now();
  const route = selectAllowedRoute(params.contract, params.snapshot.routeId);
  const fallback = selectSafeFallbackRoute(params.contract);
  const stale = nowEpochMs - params.snapshot.startedAtEpochMs > thresholds.staleAfterMs
    || params.snapshot.status === 'stale_result';
  const retryAllowed = canRetry(params.snapshot, thresholds);
  const qualityScore = clampQualityScore(params.snapshot.qualityScore);

  if (!route) {
    return buildDecision({
      action: 'deterministic_only',
      reason: 'policy_violation',
      selectedRoute: fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed: false,
      reasonCodes: ['validator_rejected_disallowed_route'],
    });
  }

  if (stale) {
    return buildDecision({
      action: retryAllowed ? 'retry_same_route' : 'fallback_route',
      reason: stale ? 'stale_result' : 'retry_budget_exhausted',
      selectedRoute: retryAllowed ? route : fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed,
      reasonCodes: retryAllowed ? route.reasonCodes : fallback.reasonCodes,
    });
  }

  if (params.snapshot.status === 'succeeded' && qualityScore !== null && qualityScore >= thresholds.minimumQualityScore) {
    return buildDecision({
      action: 'accept_current',
      reason: 'quality_acceptable',
      selectedRoute: route,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed: false,
      reasonCodes: route.reasonCodes,
    });
  }

  if (params.snapshot.status === 'timed_out' || params.snapshot.errorKind === 'timeout') {
    return buildDecision({
      action: retryAllowed ? 'retry_same_route' : 'fallback_route',
      reason: 'timeout',
      selectedRoute: retryAllowed ? route : fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed,
      reasonCodes: retryAllowed ? route.reasonCodes : fallback.reasonCodes,
    });
  }

  if (params.snapshot.status === 'failed' && params.snapshot.errorKind === 'policy_violation') {
    return buildDecision({
      action: 'deterministic_only',
      reason: 'policy_violation',
      selectedRoute: fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed: false,
      reasonCodes: ['validator_rejected_constraints'],
    });
  }

  if (params.snapshot.status === 'failed') {
    return buildDecision({
      action: retryAllowed ? 'retry_same_route' : 'fallback_route',
      reason: retryAllowed ? 'transient_failure' : 'retry_budget_exhausted',
      selectedRoute: retryAllowed ? route : fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed,
      reasonCodes: retryAllowed ? route.reasonCodes : fallback.reasonCodes,
    });
  }

  if (qualityScore !== null && qualityScore < thresholds.minimumQualityScore) {
    const shouldRetry = retryAllowed && qualityScore >= thresholds.retryableQualityFloor;
    return buildDecision({
      action: shouldRetry ? 'retry_same_route' : 'fallback_route',
      reason: 'quality_below_threshold',
      selectedRoute: shouldRetry ? route : fallback,
      snapshot: params.snapshot,
      thresholds,
      stale,
      retryAllowed: shouldRetry,
      reasonCodes: shouldRetry ? route.reasonCodes : fallback.reasonCodes,
    });
  }

  return buildDecision({
    action: fallback.id === route.id ? 'flag_for_review' : 'fallback_route',
    reason: fallback.id === route.id ? 'fallback_unavailable' : 'quality_below_threshold',
    selectedRoute: fallback,
    snapshot: params.snapshot,
    thresholds,
    stale,
    retryAllowed: false,
    reasonCodes: fallback.reasonCodes,
  });
}
