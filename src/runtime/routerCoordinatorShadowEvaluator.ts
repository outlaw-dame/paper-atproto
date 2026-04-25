import {
  validateCoordinatorRecommendation,
  validateRouterDecision,
  type CoordinationContract,
  type CoordinationReasonCode,
  type CoordinationRouteId,
  type CoordinatorRecommendationEnvelope,
  type RouterDecisionEnvelope,
} from './routerCoordinatorContract';

export type ShadowEvaluatorRole = 'router' | 'coordinator';
export type ShadowEvaluatorStatus = 'accepted' | 'rejected' | 'not_provided';

export interface RouterShadowEvaluation {
  schemaVersion: 1;
  role: 'router';
  status: ShadowEvaluatorStatus;
  advisoryRouteId: CoordinationRouteId | null;
  deterministicRouteId: CoordinationRouteId;
  selectedRouteId: CoordinationRouteId;
  advisoryMatchedDeterministic: boolean;
  reasonCodes: CoordinationReasonCode[];
}

export interface CoordinatorShadowEvaluation {
  schemaVersion: 1;
  role: 'coordinator';
  status: ShadowEvaluatorStatus;
  recommendation: CoordinatorRecommendationEnvelope['recommendation'] | null;
  advisoryRouteId: CoordinationRouteId | null;
  deterministicRouteId: CoordinationRouteId;
  selectedRouteId: CoordinationRouteId;
  advisoryMatchedDeterministic: boolean;
  reasonCodes: CoordinationReasonCode[];
  monitoringPlan: CoordinatorRecommendationEnvelope['monitoringPlan'] | null;
}

export interface RouterCoordinatorShadowEvaluation {
  schemaVersion: 1;
  router: RouterShadowEvaluation;
  coordinator: CoordinatorShadowEvaluation;
  deterministicRouteId: CoordinationRouteId;
  fallbackRouteId: CoordinationRouteId;
  contractExpiresAtEpochMs: number;
}

function findDeterministicRoute(contract: CoordinationContract): CoordinationRouteId {
  const route = contract.allowedRoutes.find((candidate) => candidate.id === contract.defaultRouteId && candidate.allowed)
    ?? contract.allowedRoutes.find((candidate) => candidate.allowed)
    ?? contract.allowedRoutes[0];
  return route?.id ?? contract.defaultRouteId;
}

function advisoryMatchesDeterministic(
  advisoryRouteId: CoordinationRouteId | null,
  deterministicRouteId: CoordinationRouteId,
): boolean {
  return advisoryRouteId !== null && advisoryRouteId === deterministicRouteId;
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
      advisoryRouteId: null,
      deterministicRouteId,
      selectedRouteId: deterministicRouteId,
      advisoryMatchedDeterministic: false,
      reasonCodes: ['validator_rejected_schema'],
    };
  }

  const validation = validateRouterDecision(params.contract, params.decision, params.nowEpochMs);
  const advisoryRouteId = validation.accepted ? validation.selectedRoute.id : null;

  return {
    schemaVersion: 1,
    role: 'router',
    status: validation.accepted ? 'accepted' : 'rejected',
    advisoryRouteId,
    deterministicRouteId,
    selectedRouteId: deterministicRouteId,
    advisoryMatchedDeterministic: advisoryMatchesDeterministic(advisoryRouteId, deterministicRouteId),
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
      advisoryRouteId: null,
      deterministicRouteId,
      selectedRouteId: deterministicRouteId,
      advisoryMatchedDeterministic: false,
      reasonCodes: ['validator_rejected_schema'],
      monitoringPlan: null,
    };
  }

  const validation = validateCoordinatorRecommendation(params.contract, params.recommendation, params.nowEpochMs);
  const acceptedRecommendation = validation.accepted
    ? validation.decision as CoordinatorRecommendationEnvelope
    : null;
  const advisoryRouteId = validation.accepted ? validation.selectedRoute.id : null;

  return {
    schemaVersion: 1,
    role: 'coordinator',
    status: validation.accepted ? 'accepted' : 'rejected',
    recommendation: acceptedRecommendation?.recommendation ?? null,
    advisoryRouteId,
    deterministicRouteId,
    selectedRouteId: deterministicRouteId,
    advisoryMatchedDeterministic: advisoryMatchesDeterministic(advisoryRouteId, deterministicRouteId),
    reasonCodes: validation.reasonCodes,
    monitoringPlan: acceptedRecommendation?.monitoringPlan ?? null,
  };
}

export function evaluateRouterCoordinatorShadow(params: {
  contract: CoordinationContract;
  routerDecision?: unknown;
  coordinatorRecommendation?: unknown;
  nowEpochMs?: number;
}): RouterCoordinatorShadowEvaluation {
  const deterministicRouteId = findDeterministicRoute(params.contract);
  return {
    schemaVersion: 1,
    router: evaluateRouterShadowDecision({
      contract: params.contract,
      decision: params.routerDecision,
      nowEpochMs: params.nowEpochMs,
    }),
    coordinator: evaluateCoordinatorShadowRecommendation({
      contract: params.contract,
      recommendation: params.coordinatorRecommendation,
      nowEpochMs: params.nowEpochMs,
    }),
    deterministicRouteId,
    fallbackRouteId: params.contract.fallbackRouteId,
    contractExpiresAtEpochMs: params.contract.expiresAtEpochMs,
  };
}
