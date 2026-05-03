import { callComposerEdgeClassifier } from '../composer/edgeClassifierClient';
import type { ComposerEdgeClassifierProvider, ComposerEdgeClassifierRequest } from '../composer/edgeClassifierContracts';
import type {
  ComposerClassifyEdgeResponse,
  EdgeExecutionPlan,
  EdgeProviderId,
  EdgeRuntimeRequest,
  EdgeRuntimeResponse,
  SearchRerankResponsePayload,
} from './edgeProviderContracts';
import type { MediaAnalysisResult } from '../llmContracts';

function toEdgeProviderId(provider: ComposerEdgeClassifierProvider): EdgeProviderId {
  return provider === 'cloudflare-workers-ai' ? 'cloudflare-workers-ai' : 'node-heuristic';
}

export async function runComposerClassifyOnEdge(
  input: ComposerEdgeClassifierRequest,
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

export class EdgeProviderMismatchError extends Error {
  readonly expected: EdgeProviderId;
  readonly actual: EdgeProviderId;

  constructor(expected: EdgeProviderId, actual: EdgeProviderId) {
    super(`Edge runtime provider mismatch: plan=${expected} response=${actual}`);
    this.name = 'EdgeProviderMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class UnsupportedEdgeProviderError extends Error {
  readonly capability: EdgeExecutionPlan['capability'];
  readonly provider: EdgeProviderId;

  constructor(capability: EdgeExecutionPlan['capability'], provider: EdgeProviderId) {
    super(`Edge runtime provider is not supported for capability ${capability}: ${provider}`);
    this.name = 'UnsupportedEdgeProviderError';
    this.capability = capability;
    this.provider = provider;
  }
}

async function postEdgeJson<TResponse>(
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    ...(signal ? { signal } : {}),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Edge endpoint request failed (${response.status}) for ${endpoint}`);
  }

  return response.json() as Promise<TResponse>;
}

function assertCloudflareProvider(plan: EdgeExecutionPlan): void {
  if (plan.provider !== 'cloudflare-workers-ai') {
    throw new UnsupportedEdgeProviderError(plan.capability, plan.provider);
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
  signal?: AbortSignal,
): Promise<EdgeRuntimeResponse> {
  if (plan.capability !== request.capability) {
    throw new EdgeCapabilityMismatchError(plan.capability, request.capability);
  }

  if (request.capability === 'composer_classify') {
    const response = await runComposerClassifyOnEdge(request.input, signal);
    const allowedProviders = new Set<EdgeProviderId>([
      plan.provider,
      ...(plan.fallbackProvider ? [plan.fallbackProvider] : []),
    ]);
    if (!allowedProviders.has(response.provider)) {
      throw new EdgeProviderMismatchError(plan.provider, response.provider);
    }
    return response;
  }

  if (request.capability === 'search_rerank') {
    assertCloudflareProvider(plan);
    const output = await postEdgeJson<SearchRerankResponsePayload>(plan.endpoint, request.input, signal);
    return {
      capability: 'search_rerank',
      provider: plan.provider,
      output,
    };
  }

  if (request.capability === 'media_classify') {
    assertCloudflareProvider(plan);
    const output = await postEdgeJson<MediaAnalysisResult>(
      plan.endpoint,
      request.input,
      signal,
    );
    return {
      capability: 'media_classify',
      provider: plan.provider,
      output,
    };
  }

  throw new UnsupportedEdgeCapabilityError(request.capability);
}
