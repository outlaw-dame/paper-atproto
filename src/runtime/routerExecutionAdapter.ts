import {
  validateRouterDecision,
  type CoordinationContract,
  type CoordinationReasonCode,
  type CoordinationRouteId,
  type CoordinationRouteOption,
  type RouterDecisionEnvelope,
} from './routerCoordinatorContract';
import {
  ROUTER_PROMPT_ID,
  ROUTER_PROMPT_VERSION,
  routerPromptOutputSchema,
  type RouterPromptOutput,
} from './prompts';

export type RouterExecutionStatus = 'accepted' | 'fallback';
export type RouterExecutionFallbackReason =
  | 'missing_output'
  | 'schema_rejected'
  | 'prompt_identity_mismatch'
  | 'contract_identity_mismatch'
  | 'contract_rejected';

export interface RouterExecutionResult {
  schemaVersion: 1;
  status: RouterExecutionStatus;
  selectedRoute: CoordinationRouteOption;
  selectedRouteId: CoordinationRouteId;
  routerDecision: RouterDecisionEnvelope | null;
  fallbackReason: RouterExecutionFallbackReason | null;
  reasonCodes: CoordinationReasonCode[];
  diagnostics: {
    promptId: typeof ROUTER_PROMPT_ID;
    promptVersion: typeof ROUTER_PROMPT_VERSION;
    contractId: string;
    acceptedBySchema: boolean;
    acceptedByContract: boolean;
  };
}

function selectFallbackRoute(contract: CoordinationContract): CoordinationRouteOption {
  const route = contract.allowedRoutes.find((candidate) => candidate.id === contract.fallbackRouteId && candidate.allowed)
    ?? contract.allowedRoutes.find((candidate) => candidate.id === contract.defaultRouteId && candidate.allowed)
    ?? contract.allowedRoutes.find((candidate) => candidate.allowed)
    ?? contract.allowedRoutes[0];

  if (!route) {
    throw new Error('CoordinationContract invariant violated: allowedRoutes must be non-empty');
  }
  return route;
}

function fallbackResult(params: {
  contract: CoordinationContract;
  contractId: string;
  reason: RouterExecutionFallbackReason;
  reasonCodes?: CoordinationReasonCode[];
  acceptedBySchema?: boolean;
  acceptedByContract?: boolean;
}): RouterExecutionResult {
  const selectedRoute = selectFallbackRoute(params.contract);
  return {
    schemaVersion: 1,
    status: 'fallback',
    selectedRoute,
    selectedRouteId: selectedRoute.id,
    routerDecision: null,
    fallbackReason: params.reason,
    reasonCodes: params.reasonCodes ?? [],
    diagnostics: {
      promptId: ROUTER_PROMPT_ID,
      promptVersion: ROUTER_PROMPT_VERSION,
      contractId: params.contractId,
      acceptedBySchema: params.acceptedBySchema ?? false,
      acceptedByContract: params.acceptedByContract ?? false,
    },
  };
}

function toRouterDecisionEnvelope(output: RouterPromptOutput): RouterDecisionEnvelope {
  return {
    schemaVersion: output.schemaVersion,
    decisionType: output.decisionType,
    selectedRouteId: output.selectedRouteId as CoordinationRouteId,
    confidence: output.confidence,
    reasonCodes: output.reasonCodes,
    ttlMs: output.ttlMs,
  };
}

export function evaluateRouterPromptOutput(params: {
  contract: CoordinationContract;
  contractId: string;
  output: unknown;
  nowEpochMs?: number;
}): RouterExecutionResult {
  if (params.output === undefined || params.output === null) {
    return fallbackResult({
      contract: params.contract,
      contractId: params.contractId,
      reason: 'missing_output',
    });
  }

  const parsed = routerPromptOutputSchema.safeParse(params.output);
  if (!parsed.success) {
    return fallbackResult({
      contract: params.contract,
      contractId: params.contractId,
      reason: 'schema_rejected',
      reasonCodes: ['validator_rejected_schema'],
    });
  }

  if (parsed.data.promptId !== ROUTER_PROMPT_ID || parsed.data.promptVersion !== ROUTER_PROMPT_VERSION) {
    return fallbackResult({
      contract: params.contract,
      contractId: params.contractId,
      reason: 'prompt_identity_mismatch',
      reasonCodes: ['validator_rejected_schema'],
      acceptedBySchema: true,
    });
  }

  if (parsed.data.contractId !== params.contractId) {
    return fallbackResult({
      contract: params.contract,
      contractId: params.contractId,
      reason: 'contract_identity_mismatch',
      reasonCodes: ['validator_rejected_constraints'],
      acceptedBySchema: true,
    });
  }

  const decision = toRouterDecisionEnvelope(parsed.data);
  const validation = validateRouterDecision(params.contract, decision, params.nowEpochMs);
  if (!validation.accepted) {
    return fallbackResult({
      contract: params.contract,
      contractId: params.contractId,
      reason: 'contract_rejected',
      reasonCodes: validation.reasonCodes,
      acceptedBySchema: true,
    });
  }

  return {
    schemaVersion: 1,
    status: 'accepted',
    selectedRoute: validation.selectedRoute,
    selectedRouteId: validation.selectedRoute.id,
    routerDecision: validation.decision,
    fallbackReason: null,
    reasonCodes: validation.reasonCodes,
    diagnostics: {
      promptId: ROUTER_PROMPT_ID,
      promptVersion: ROUTER_PROMPT_VERSION,
      contractId: params.contractId,
      acceptedBySchema: true,
      acceptedByContract: true,
    },
  };
}
