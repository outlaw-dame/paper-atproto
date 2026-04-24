import type { AiStackProfile } from './aiStackProfile';
import type { ModelPolicyDecision, TaskKind } from './modelPolicy';
import {
  buildCoordinationContract,
  type CoordinationContract,
  type CoordinationRouteId,
  type CoordinationRouteOption,
} from './routerCoordinatorContract';

export type RouterCoordinatorReadiness =
  | 'deterministic_only'
  | 'router_shadow_ready'
  | 'coordinator_shadow_ready'
  | 'blocked';

export type RouterCoordinatorBlocker =
  | 'contract_expired'
  | 'no_allowed_routes'
  | 'stack_baseline'
  | 'coordinator_unavailable'
  | 'large_model_requires_consent'
  | 'explicit_user_action_required';

export interface RouterCoordinatorDiagnosticsSnapshot {
  schemaVersion: 1;
  task: TaskKind;
  readiness: RouterCoordinatorReadiness;
  blockers: RouterCoordinatorBlocker[];
  defaultRouteId: CoordinationRouteId;
  fallbackRouteId: CoordinationRouteId;
  allowedRoutes: Array<{
    id: CoordinationRouteId;
    kind: CoordinationRouteOption['kind'];
    model: CoordinationRouteOption['model'];
    source: CoordinationRouteOption['source'];
    requiresExplicitUserAction: boolean;
    remoteFallbackAllowed: boolean;
  }>;
  stack: {
    tier: AiStackProfile['tier'];
    runtime: AiStackProfile['runtime'];
    routerModel: AiStackProfile['router']['id'];
    coordinatorModel: AiStackProfile['coordinator']['id'];
    coordinatorRequiresConsent: boolean;
  };
  policy: {
    choice: ModelPolicyDecision['choice'];
    fallbackChoices: ModelPolicyDecision['fallbackChoices'];
    localAllowed: boolean;
    remoteFallbackAllowed: boolean;
    requiresExplicitUserAction: boolean;
  };
  contractExpiresAtEpochMs: number;
}

function uniqueBlockers(blockers: RouterCoordinatorBlocker[]): RouterCoordinatorBlocker[] {
  return Array.from(new Set(blockers));
}

function deriveBlockers(params: {
  contract: CoordinationContract;
  stackProfile: AiStackProfile;
  policyDecision: ModelPolicyDecision;
  nowEpochMs: number;
}): RouterCoordinatorBlocker[] {
  const blockers: RouterCoordinatorBlocker[] = [];
  const { contract, stackProfile, policyDecision, nowEpochMs } = params;

  if (nowEpochMs > contract.expiresAtEpochMs) blockers.push('contract_expired');
  if (contract.allowedRoutes.length === 0) blockers.push('no_allowed_routes');
  if (stackProfile.tier === 'baseline') blockers.push('stack_baseline');
  if (stackProfile.coordinator.id === 'none') blockers.push('coordinator_unavailable');
  if (stackProfile.coordinator.requiresExplicitConsent) blockers.push('large_model_requires_consent');
  if (policyDecision.requiresExplicitUserAction) blockers.push('explicit_user_action_required');

  return uniqueBlockers(blockers);
}

function deriveReadiness(params: {
  blockers: RouterCoordinatorBlocker[];
  stackProfile: AiStackProfile;
}): RouterCoordinatorReadiness {
  const { blockers, stackProfile } = params;
  if (blockers.includes('contract_expired') || blockers.includes('no_allowed_routes')) return 'blocked';
  if (blockers.includes('stack_baseline') || blockers.includes('coordinator_unavailable')) return 'deterministic_only';
  if (stackProfile.coordinator.id !== 'none' && !stackProfile.coordinator.requiresExplicitConsent) {
    return 'coordinator_shadow_ready';
  }
  if (stackProfile.router.id !== 'deterministic_policy') return 'router_shadow_ready';
  return 'deterministic_only';
}

export function buildRouterCoordinatorDiagnosticsSnapshot(params: {
  policyDecision: ModelPolicyDecision;
  stackProfile: AiStackProfile;
  nowEpochMs?: number;
  ttlMs?: number;
}): RouterCoordinatorDiagnosticsSnapshot {
  const nowEpochMs = Number.isFinite(params.nowEpochMs) ? Number(params.nowEpochMs) : Date.now();
  const contract = buildCoordinationContract({
    policyDecision: params.policyDecision,
    stackProfile: params.stackProfile,
    nowEpochMs,
    ttlMs: params.ttlMs,
  });
  const blockers = deriveBlockers({
    contract,
    stackProfile: params.stackProfile,
    policyDecision: params.policyDecision,
    nowEpochMs,
  });

  return {
    schemaVersion: 1,
    task: params.policyDecision.task,
    readiness: deriveReadiness({ blockers, stackProfile: params.stackProfile }),
    blockers,
    defaultRouteId: contract.defaultRouteId,
    fallbackRouteId: contract.fallbackRouteId,
    allowedRoutes: contract.allowedRoutes.map((route) => ({
      id: route.id,
      kind: route.kind,
      model: route.model,
      source: route.source,
      requiresExplicitUserAction: route.requiresExplicitUserAction,
      remoteFallbackAllowed: route.remoteFallbackAllowed,
    })),
    stack: {
      tier: params.stackProfile.tier,
      runtime: params.stackProfile.runtime,
      routerModel: params.stackProfile.router.id,
      coordinatorModel: params.stackProfile.coordinator.id,
      coordinatorRequiresConsent: params.stackProfile.coordinator.requiresExplicitConsent,
    },
    policy: {
      choice: params.policyDecision.choice,
      fallbackChoices: params.policyDecision.fallbackChoices,
      localAllowed: params.policyDecision.localAllowed,
      remoteFallbackAllowed: params.policyDecision.remoteFallbackAllowed,
      requiresExplicitUserAction: params.policyDecision.requiresExplicitUserAction,
    },
    contractExpiresAtEpochMs: contract.expiresAtEpochMs,
  };
}
