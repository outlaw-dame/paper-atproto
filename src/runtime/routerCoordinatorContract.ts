import type { AiModelBinding, AiStackProfile } from './aiStackProfile';
import type { ModelChoice, ModelPolicyDecision, TaskKind } from './modelPolicy';

export type CoordinationSchemaVersion = 1;
export type CoordinationTask = TaskKind | 'router_coordination';
export type CoordinationPathKind =
  | 'deterministic_only'
  | 'local_worker'
  | 'local_generation'
  | 'local_multimodal'
  | 'remote_fallback';

export type CoordinationRouteId =
  | 'policy_baseline'
  | 'worker_local_only'
  | `model:${ModelChoice}`
  | 'remote:fallback';

export type CoordinationReasonCode =
  | 'policy_selected_primary'
  | 'policy_selected_fallback'
  | 'policy_requires_explicit_action'
  | 'policy_disallows_local'
  | 'policy_allows_remote_fallback'
  | 'validator_rejected_unknown_route'
  | 'validator_rejected_disallowed_route'
  | 'validator_rejected_schema'
  | 'validator_rejected_confidence'
  | 'validator_rejected_ttl'
  | 'validator_rejected_constraints';

export type CoordinationConstraint =
  | 'no_new_routes'
  | 'schema_validated'
  | 'deterministic_policy_is_authority'
  | 'no_private_payloads'
  | 'structured_output_only'
  | 'no_confidence_mutation'
  | 'no_safety_override'
  | 'honor_explicit_user_action_gate'
  | 'honor_large_model_consent_gate'
  | 'shadow_mode_only';

export interface CoordinationRouteOption {
  id: CoordinationRouteId;
  kind: CoordinationPathKind;
  model: ModelChoice | null;
  source: 'model_policy' | 'ai_stack_profile';
  allowed: boolean;
  requiresExplicitUserAction: boolean;
  remoteFallbackAllowed: boolean;
  reasonCodes: CoordinationReasonCode[];
}

export interface CoordinationContract {
  schemaVersion: CoordinationSchemaVersion;
  task: CoordinationTask;
  policyDecision: ModelPolicyDecision;
  stack: {
    tier: AiStackProfile['tier'];
    runtime: AiStackProfile['runtime'];
    router: AiModelBinding;
    coordinator: AiModelBinding;
    fallbackCoordinator: AiModelBinding;
  };
  allowedRoutes: CoordinationRouteOption[];
  defaultRouteId: CoordinationRouteId;
  fallbackRouteId: CoordinationRouteId;
  constraints: CoordinationConstraint[];
  expiresAtEpochMs: number;
}

export type RouterDecisionType = 'route' | 'fallback' | 'abstain';

export interface RouterDecisionEnvelope {
  schemaVersion: CoordinationSchemaVersion;
  decisionType: RouterDecisionType;
  selectedRouteId: CoordinationRouteId;
  confidence: number;
  reasonCodes: CoordinationReasonCode[];
  ttlMs: number;
}

export type CoordinatorRecommendationType =
  | 'accept_route'
  | 'prefer_fallback'
  | 'abstain'
  | 'flag_for_review';

export interface CoordinatorRecommendationEnvelope {
  schemaVersion: CoordinationSchemaVersion;
  recommendation: CoordinatorRecommendationType;
  selectedRouteId: CoordinationRouteId;
  confidence: number;
  reasonCodes: CoordinationReasonCode[];
  monitoringPlan: {
    watchFlags: Array<'stale_output' | 'low_confidence' | 'model_error' | 'latency_regression' | 'policy_violation'>;
    maxRetries: 0 | 1;
    fallbackRouteId: CoordinationRouteId;
  };
  ttlMs: number;
}

export interface CoordinationValidationResult<TDecision> {
  accepted: boolean;
  decision: TDecision | null;
  selectedRoute: CoordinationRouteOption;
  reasonCodes: CoordinationReasonCode[];
}

const DEFAULT_CONTRACT_TTL_MS = 15_000;
const MAX_DECISION_TTL_MS = 15_000;

function routeIdForModel(model: ModelChoice): CoordinationRouteId {
  return model === 'worker_local_only' ? 'worker_local_only' : `model:${model}`;
}

function pathKindForTask(task: TaskKind, model: ModelChoice): CoordinationPathKind {
  if (model === 'worker_local_only') return task === 'hot_path_scoring' ? 'deterministic_only' : 'local_worker';
  if (task === 'multimodal_analysis') return 'local_multimodal';
  return 'local_generation';
}

function uniqueReasonCodes(codes: CoordinationReasonCode[]): CoordinationReasonCode[] {
  return Array.from(new Set(codes));
}

function fallbackRouteOption(policyDecision: ModelPolicyDecision): CoordinationRouteOption {
  return {
    id: 'remote:fallback',
    kind: 'remote_fallback',
    model: null,
    source: 'model_policy',
    allowed: policyDecision.remoteFallbackAllowed,
    requiresExplicitUserAction: policyDecision.requiresExplicitUserAction,
    remoteFallbackAllowed: policyDecision.remoteFallbackAllowed,
    reasonCodes: policyDecision.remoteFallbackAllowed
      ? ['policy_allows_remote_fallback']
      : ['policy_disallows_local'],
  };
}

export function buildCoordinationContract(params: {
  policyDecision: ModelPolicyDecision;
  stackProfile: AiStackProfile;
  nowEpochMs?: number;
  ttlMs?: number;
}): CoordinationContract {
  const { policyDecision, stackProfile } = params;
  const nowEpochMs = Number.isFinite(params.nowEpochMs) ? Number(params.nowEpochMs) : Date.now();
  const ttlMs = Math.max(1, Math.min(params.ttlMs ?? DEFAULT_CONTRACT_TTL_MS, DEFAULT_CONTRACT_TTL_MS));

  const primaryReasonCodes: CoordinationReasonCode[] = ['policy_selected_primary'];
  if (policyDecision.requiresExplicitUserAction) primaryReasonCodes.push('policy_requires_explicit_action');
  if (!policyDecision.localAllowed) primaryReasonCodes.push('policy_disallows_local');
  if (policyDecision.remoteFallbackAllowed) primaryReasonCodes.push('policy_allows_remote_fallback');

  const primaryRoute: CoordinationRouteOption = {
    id: routeIdForModel(policyDecision.choice),
    kind: pathKindForTask(policyDecision.task, policyDecision.choice),
    model: policyDecision.choice,
    source: 'model_policy',
    allowed: policyDecision.localAllowed || policyDecision.choice === 'worker_local_only',
    requiresExplicitUserAction: policyDecision.requiresExplicitUserAction,
    remoteFallbackAllowed: policyDecision.remoteFallbackAllowed,
    reasonCodes: uniqueReasonCodes(primaryReasonCodes),
  };

  const fallbackRoutes = policyDecision.fallbackChoices.map((choice): CoordinationRouteOption => ({
    id: routeIdForModel(choice),
    kind: pathKindForTask(policyDecision.task, choice),
    model: choice,
    source: 'model_policy',
    allowed: policyDecision.localAllowed,
    requiresExplicitUserAction: policyDecision.requiresExplicitUserAction,
    remoteFallbackAllowed: policyDecision.remoteFallbackAllowed,
    reasonCodes: uniqueReasonCodes([
      'policy_selected_fallback',
      ...(policyDecision.requiresExplicitUserAction ? ['policy_requires_explicit_action' as const] : []),
    ]),
  }));

  const remoteFallback = fallbackRouteOption(policyDecision);
  const allowedRoutes = [primaryRoute, ...fallbackRoutes, remoteFallback].filter((route) => route.allowed);
  const fallbackRoute = allowedRoutes.find((route) => route.id !== primaryRoute.id) ?? primaryRoute;

  return {
    schemaVersion: 1,
    task: policyDecision.task,
    policyDecision,
    stack: {
      tier: stackProfile.tier,
      runtime: stackProfile.runtime,
      router: stackProfile.router,
      coordinator: stackProfile.coordinator,
      fallbackCoordinator: stackProfile.fallbackCoordinator,
    },
    allowedRoutes: allowedRoutes.length > 0 ? allowedRoutes : [primaryRoute],
    defaultRouteId: primaryRoute.allowed ? primaryRoute.id : fallbackRoute.id,
    fallbackRouteId: fallbackRoute.id,
    constraints: [
      'no_new_routes',
      'schema_validated',
      'deterministic_policy_is_authority',
      'no_private_payloads',
      'structured_output_only',
      'no_confidence_mutation',
      'no_safety_override',
      'honor_explicit_user_action_gate',
      'honor_large_model_consent_gate',
      'shadow_mode_only',
    ],
    expiresAtEpochMs: nowEpochMs + ttlMs,
  };
}

function isValidConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidTtl(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DECISION_TTL_MS;
}

function selectSafeFallbackRoute(contract: CoordinationContract): CoordinationRouteOption {
  return (
    contract.allowedRoutes.find((route) => route.id === contract.fallbackRouteId)
    ?? contract.allowedRoutes.find((route) => route.id === contract.defaultRouteId)
    ?? contract.allowedRoutes[0]
  );
}

function findAllowedRoute(contract: CoordinationContract, routeId: CoordinationRouteId): CoordinationRouteOption | null {
  return contract.allowedRoutes.find((route) => route.id === routeId && route.allowed) ?? null;
}

export function validateRouterDecision(
  contract: CoordinationContract,
  decision: unknown,
  nowEpochMs = Date.now(),
): CoordinationValidationResult<RouterDecisionEnvelope> {
  const fallback = selectSafeFallbackRoute(contract);
  if (nowEpochMs > contract.expiresAtEpochMs) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_ttl'] };
  }
  if (!decision || typeof decision !== 'object') {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_schema'] };
  }

  const candidate = decision as Partial<RouterDecisionEnvelope>;
  if (
    candidate.schemaVersion !== 1
    || (candidate.decisionType !== 'route' && candidate.decisionType !== 'fallback' && candidate.decisionType !== 'abstain')
    || !Array.isArray(candidate.reasonCodes)
  ) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_schema'] };
  }
  if (!isValidConfidence(candidate.confidence)) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_confidence'] };
  }
  if (!isValidTtl(candidate.ttlMs)) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_ttl'] };
  }

  const requestedRoute = candidate.decisionType === 'fallback'
    ? findAllowedRoute(contract, contract.fallbackRouteId)
    : candidate.decisionType === 'abstain'
      ? findAllowedRoute(contract, contract.defaultRouteId)
      : findAllowedRoute(contract, candidate.selectedRouteId as CoordinationRouteId);

  if (!requestedRoute) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_unknown_route'] };
  }
  if (!contract.constraints.includes('deterministic_policy_is_authority')) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_constraints'] };
  }

  return {
    accepted: true,
    decision: candidate as RouterDecisionEnvelope,
    selectedRoute: requestedRoute,
    reasonCodes: candidate.reasonCodes.length > 0 ? candidate.reasonCodes : requestedRoute.reasonCodes,
  };
}

export function validateCoordinatorRecommendation(
  contract: CoordinationContract,
  recommendation: unknown,
  nowEpochMs = Date.now(),
): CoordinationValidationResult<CoordinatorRecommendationEnvelope> {
  const fallback = selectSafeFallbackRoute(contract);
  if (nowEpochMs > contract.expiresAtEpochMs) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_ttl'] };
  }
  if (!recommendation || typeof recommendation !== 'object') {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_schema'] };
  }

  const candidate = recommendation as Partial<CoordinatorRecommendationEnvelope>;
  if (
    candidate.schemaVersion !== 1
    || (
      candidate.recommendation !== 'accept_route'
      && candidate.recommendation !== 'prefer_fallback'
      && candidate.recommendation !== 'abstain'
      && candidate.recommendation !== 'flag_for_review'
    )
    || !Array.isArray(candidate.reasonCodes)
    || !candidate.monitoringPlan
    || !Array.isArray(candidate.monitoringPlan.watchFlags)
  ) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_schema'] };
  }
  if (!isValidConfidence(candidate.confidence)) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_confidence'] };
  }
  if (!isValidTtl(candidate.ttlMs)) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_ttl'] };
  }
  if (candidate.monitoringPlan.maxRetries !== 0 && candidate.monitoringPlan.maxRetries !== 1) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_constraints'] };
  }

  const requestedRoute = candidate.recommendation === 'prefer_fallback'
    ? findAllowedRoute(contract, contract.fallbackRouteId)
    : candidate.recommendation === 'abstain' || candidate.recommendation === 'flag_for_review'
      ? findAllowedRoute(contract, contract.defaultRouteId)
      : findAllowedRoute(contract, candidate.selectedRouteId as CoordinationRouteId);

  if (!requestedRoute) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_unknown_route'] };
  }
  if (!findAllowedRoute(contract, candidate.monitoringPlan.fallbackRouteId as CoordinationRouteId)) {
    return { accepted: false, decision: null, selectedRoute: fallback, reasonCodes: ['validator_rejected_disallowed_route'] };
  }

  return {
    accepted: true,
    decision: candidate as CoordinatorRecommendationEnvelope,
    selectedRoute: requestedRoute,
    reasonCodes: candidate.reasonCodes.length > 0 ? candidate.reasonCodes : requestedRoute.reasonCodes,
  };
}
