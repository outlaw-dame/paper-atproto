import { callComposerEdgeClassifier } from '../composer/edgeClassifierClient';
import type { ComposerEdgeClassifierProvider, ComposerEdgeClassifierRequest } from '../composer/edgeClassifierContracts';
import type { ComposerClassifyEdgeResponse, EdgeProviderId } from './edgeProviderContracts';
import type { EdgeProviderCoordinatorOptions } from './edgeProviderCoordinator';

function toEdgeProviderId(provider: ComposerEdgeClassifierProvider): EdgeProviderId {
  return provider === 'cloudflare-workers-ai' ? 'cloudflare-workers-ai' : 'node-heuristic';
}

export async function runComposerClassifyOnEdge(
  input: ComposerEdgeClassifierRequest,
  _options: EdgeProviderCoordinatorOptions = {},
  signal?: AbortSignal,
): Promise<ComposerClassifyEdgeResponse> {
  const output = await callComposerEdgeClassifier(input, signal);
  return {
    capability: 'composer_classify',
    provider: toEdgeProviderId(output.provider),
    output,
  };
}
