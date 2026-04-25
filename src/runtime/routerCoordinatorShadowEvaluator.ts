import {
  validateCoordinatorRecommendation,
  validateRouterDecision,
  type CoordinationContract,
  type CoordinationReasonCode,
  type CoordinationRouteId,
  type CoordinatorRecommendationEnvelope,
} from './routerCoordinatorContract';

export type ShadowEvaluatorRole = 'router' | 'coordinator';
export type ShadowEvaluatorStatus = 'accepted' | 'rejected' | 'not_provided';

export interface RouterShadowEvaluation {
  schemaVersion: 1;
  role: 'router';
  status: ShadowEvaluatorStatus;
  routerRouteId: CoordinationRouteId | null;
  deterministicRouteId: CoordinationRouteId;
  selectedRouteId: CoordinationRouteId;
  authorityApplied: boolean;
  routerMatchedDeterministic: boolean;
  reasonCodes: CoordinationReasonCode[];
}

export interface CoordinatorShadowEvaluation {
  schemaVersion: 1;
  role: 'coordinator';
  status: ShadowEvaluatorStatus;
  recommendation: CoordinatorRecommendationEnvelope['recommendation'] | null;
  recommendationRouteId: CoordinationRouteId | null;
  deterministicRouteId: CoordinationRouteId;
  selectedRouteId: CoordinationRouteId;
  recommendationMatchedDeterministic: boolean;
  reasonCodes: CoordinationReasonCode[];
  monitoringPlan: CoordinatorRecommendationEnvelope['monitoringPlan'] | null;
}

export interface RouterCoordinatorShadowEvaluation {
  schemaVersion: 1;
  router: RouterShadowEvaluation;
  coordinator: CoordinatorShadowEvaluation;
  deterministicRouteId: CoordinationRouteId;
  selectedRouteId: CoordinationRouteId;
  fallbackRouteId: CoordinationRouteId;
  contractExpiresAtEpochMs: number;
}

function findDeterministicRoute(contract: CoordinationContract): CoordinationRouteId {
  const route = contract.allowedRoutes.find((candidate) => candidate.id === contract.defaultRouteId && candidate.allowed)
    ?? contract.allowedRoutes.find((candidate) => candidate.allowed)
    ?? contract.allowedRoutes[0];
  return route?.id ?? contract.defaultRouteId;
}

function routeMatchesDeterministic(
  routeId: CoordinationRouteId | null,
  deterministicRouteId: CoordinationRouteId,
): boolean {
  return routeId !== null && routeId === deterministicRouteId;
}

export function evaluateRouterShadowDecision(params: {
  contract: CoordinationContract;
  decision?: unknown;
  nowEpochMs?: number;
}): RouterShadowEvaluation {
  const deterministicRouteId = findDeterministicRoute(params.contract);
  if (params.decision === undefined || params.decision === null) {
    return {
      schemaVersion: 1,
      role: 'router',
      status: 'not_provided',
      routerRouteId: null,
      deterministicRouteId,
      selectedRouteId: deterministicRouteId,
      authorityApplied: false,
      routerMatchedDeterministic: false,
      reasonCodes: [],
    };
  }

  const validation = validateRouterDecision(params.contract, params.decision, params.nowEpochMs);
  const routerRouteId = validation.accepted ? validation.selectedRoute.id : null;
  const selectedRouteId = routerRouteId ?? deterministicRouteId;

  return {
    schemaVersion: 1,
    role: 'router',
    status: validation.accepted ? 'accepted' : 'rejected',
    routerRouteId,
    deterministicRouteId,
    selectedRouteId,
    authorityApplied: validation.accepted,
    routerMatchedDeterministic: routeMatchesDeterministic(routerRouteId, deterministicRouteId),
    reasonCodes: validation.reasonCodes,
  };
}

export function evaluateCoordinatorShadowRecommendation(params: {
  contract: CoordinationContract;
  recommendation?: unknown;
  nowEpochMs?: number;
}): CoordinatorShadowEvaluation {
  const deterministicRouteId = findDeterministicRoute(params.contract);
  if (params.recommendation === undefined || params.recommendation === null) {
    return {
      schemaVersion: 1,
      role: 'coordinator',
      status: 'not_provided',
      recommendation: null,
      recommendationRouteId: null,
      deterministicRouteId,
      selectedRouteId: deterministicRouteId,
      recommendationMatchedDeterministic: false,
      reasonCodes: [],
      monitoringPlan: null,
    };
  }

  const validation = validateCoordinatorRecommendation(params.contract, params.recommendation, params.nowEpochMs);
  const acceptedRecommendation = validation.accepted
    ? validation.decision as CoordinatorRecommendationEnvelope
    : null;
  const recommendationRouteId = validation.accepted ? validation.selectedRoute.id : null;

  return {
    schemaVersion: 1,
    role: 'coordinator',
    status: validation.accepted ? 'accepted' : 'rejected',
    recommendation: acceptedRecommendation?.recommendation ?? null,
    recommendationRouteId,
    deterministicRouteId,
    selectedRouteId: deterministicRouteId,
    recommendationMatchedDeterministic: routeMatchesDeterministic(recommendationRouteId, deterministicRouteId),
    reasonCodes: validation.reasonCodes,
    monitoringPlan: acceptedRecommendation?.monitoringPlan ?? null,
  };
}

function optionalNowEpochMsParam(nowEpochMs: number | undefined): { nowEpochMs?: number } {
  return nowEpochMs === undefined ? {} : { nowEpochMs };
}

export function evaluateRouterCoordinatorShadow(params: {
  contract: CoordinationContract;
  routerDecision?: unknown;
  coordinatorRecommendation?: unknown;
  nowEpochMs?: number;
}): RouterCoordinatorShadowEvaluation {
  const deterministicRouteId = findDeterministicRoute(params.contract);
  const router = evaluateRouterShadowDecision({
    contract: params.contract,
    decision: params.routerDecision,
    ...optionalNowEpochMsParam(params.nowEpochMs),
  });

  return {
    schemaVersion: 1,
    router,
    coordinator: evaluateCoordinatorShadowRecommendation({
      contract: params.contract,
      recommendation: params.coordinatorRecommendation,
      ...optionalNowEpochMsParam(params.nowEpochMs),
    }),
    deterministicRouteId,
    selectedRouteId: router.selectedRouteId,
    fallbackRouteId: params.contract.fallbackRouteId,
    contractExpiresAtEpochMs: params.contract.expiresAtEpochMs,
  };
}
