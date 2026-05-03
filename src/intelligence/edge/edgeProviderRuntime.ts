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
import {
  recordEdgeRuntimeAttempt,
  recordEdgeRuntimeFailure,
  recordEdgeRuntimeSuccess,
} from './edgeProviderRuntimeTelemetry';

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

export class EdgeEndpointRequestError extends Error {
  readonly endpoint: string;
  readonly status: number;

  constructor(endpoint: string, status: number) {
    super(`Edge endpoint request failed (${status}) for ${endpoint}`);
    this.name = 'EdgeEndpointRequestError';
    this.endpoint = endpoint;
    this.status = status;
  }
}

export class EdgeEndpointResponseTypeError extends Error {
  readonly endpoint: string;
  readonly contentType: string | null;

  constructor(endpoint: string, contentType: string | null) {
    super(`Expected JSON response from ${endpoint} but got ${contentType ?? 'none'}`);
    this.name = 'EdgeEndpointResponseTypeError';
    this.endpoint = endpoint;
    this.contentType = contentType;
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
    signal: signal ?? null,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new EdgeEndpointRequestError(endpoint, response.status);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    throw new EdgeEndpointResponseTypeError(endpoint, contentType);
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
  recordEdgeRuntimeAttempt(request.capability);

  if (plan.capability !== request.capability) {
    recordEdgeRuntimeFailure(request.capability, 'capability_mismatch');
    throw new EdgeCapabilityMismatchError(plan.capability, request.capability);
  }

  if (request.capability === 'composer_classify') {
    let response: ComposerClassifyEdgeResponse;
    try {
      response = await runComposerClassifyOnEdge(request.input, signal);
    } catch (error) {
      recordEdgeRuntimeFailure(request.capability, 'provider_execution_error');
      throw error;
    }
    const allowedProviders = new Set<EdgeProviderId>([
      plan.provider,
      ...(plan.fallbackProvider ? [plan.fallbackProvider] : []),
    ]);
    if (!allowedProviders.has(response.provider)) {
      recordEdgeRuntimeFailure(request.capability, 'provider_mismatch');
      throw new EdgeProviderMismatchError(plan.provider, response.provider);
    }
    recordEdgeRuntimeSuccess(request.capability);
    return response;
  }

  if (request.capability === 'search_rerank') {
    // Route guard: this capability is planned, but the canonical server
    // endpoint (`/api/llm/rerank/search`) is not mounted yet. Keep this
    // explicit until that route lands to avoid runtime 404 regressions.
    recordEdgeRuntimeFailure(request.capability, 'capability_unsupported');
    throw new UnsupportedEdgeCapabilityError(request.capability);
  }

  if (request.capability === 'media_classify') {
    try {
      assertCloudflareProvider(plan);
    } catch (error) {
      recordEdgeRuntimeFailure(request.capability, 'provider_unsupported');
      throw error;
    }

    let output: MediaAnalysisResult;
    try {
      output = await postEdgeJson<MediaAnalysisResult>(
        plan.endpoint,
        request.input,
        signal,
      );
    } catch (error) {
      if (error instanceof EdgeEndpointRequestError) {
        recordEdgeRuntimeFailure(request.capability, 'endpoint_http_error');
      } else if (error instanceof EdgeEndpointResponseTypeError) {
        recordEdgeRuntimeFailure(request.capability, 'endpoint_non_json');
      } else {
        recordEdgeRuntimeFailure(request.capability, 'endpoint_network_error');
      }
      throw error;
    }

    recordEdgeRuntimeSuccess(request.capability);
    return {
      capability: 'media_classify',
      provider: plan.provider,
      output,
    };
  }

  recordEdgeRuntimeFailure(request.capability, 'capability_unsupported');
  throw new UnsupportedEdgeCapabilityError(request.capability);
}
