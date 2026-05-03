import { callComposerEdgeClassifier } from '../composer/edgeClassifierClient';
import type { ComposerEdgeClassifierProvider, ComposerEdgeClassifierRequest } from '../composer/edgeClassifierContracts';
import type {
  ComposerClassifyEdgeResponse,
  EdgeExecutionPlan,
  EdgeProviderId,
  EdgeRuntimeRequest,
  EdgeRuntimeResponse,
} from './edgeProviderContracts';
import type { EdgeProviderPlannerOptions } from './edgeProviderPlanner';

function toEdgeProviderId(provider: ComposerEdgeClassifierProvider): EdgeProviderId {
  return provider === 'cloudflare-workers-ai' ? 'cloudflare-workers-ai' : 'node-heuristic';
}

export async function runComposerClassifyOnEdge(
  input: ComposerEdgeClassifierRequest,
  _options: EdgeProviderPlannerOptions = {},
  signal?: AbortSignal,
): Promise<ComposerClassifyEdgeResponse> {
  const output = await callComposerEdgeClassifier(input, signal);
  return {
    capability: 'composer_classify',
    provider: toEdgeProviderId(output.provider),
    output,
  };
}

export class UnsupportedEdgeCapabilityError extends Error {
  readonly capability: EdgeExecutionPlan['capability'];

  constructor(capability: EdgeExecutionPlan['capability']) {
    super(`Edge runtime does not yet implement capability: ${capability}`);
    this.name = 'UnsupportedEdgeCapabilityError';
    this.capability = capability;
  }
}

export class EdgeCapabilityMismatchError extends Error {
  readonly expected: EdgeExecutionPlan['capability'];
  readonly actual: EdgeRuntimeRequest['capability'];

  constructor(expected: EdgeExecutionPlan['capability'], actual: EdgeRuntimeRequest['capability']) {
    super(`Edge runtime capability mismatch: plan=${expected} request=${actual}`);
    this.name = 'EdgeCapabilityMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Dispatches edge execution by planned capability.
 *
 * Item 12b scaffolding: composer path is fully implemented and preserved;
 * remaining capabilities are routed but intentionally explicit about being
 * unimplemented so follow-up slices can add them behind the same contract.
 */
export async function runEdgeExecution(
  plan: EdgeExecutionPlan,
  request: EdgeRuntimeRequest,
  options: EdgeProviderPlannerOptions = {},
  signal?: AbortSignal,
): Promise<EdgeRuntimeResponse> {
  if (plan.capability !== request.capability) {
    throw new EdgeCapabilityMismatchError(plan.capability, request.capability);
  }

  if (request.capability === 'composer_classify') {
    return runComposerClassifyOnEdge(request.input, options, signal);
  }

  throw new UnsupportedEdgeCapabilityError(request.capability);
}
