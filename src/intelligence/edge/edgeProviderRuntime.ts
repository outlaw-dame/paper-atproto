import { callComposerEdgeClassifier } from '../composer/edgeClassifierClient';
import type { ComposerEdgeClassifierRequest } from '../composer/edgeClassifierContracts';
import type { ComposerClassifyEdgeResponse } from './edgeProviderContracts';
import type { EdgeProviderCoordinatorOptions } from './edgeProviderCoordinator';

export async function runComposerClassifyOnEdge(
  input: ComposerEdgeClassifierRequest,
  _options: EdgeProviderCoordinatorOptions = {},
  signal?: AbortSignal,
): Promise<ComposerClassifyEdgeResponse> {
  const output = await callComposerEdgeClassifier(input, signal);
  return {
    capability: 'composer_classify',
    provider: output.provider,
    output,
  };
}
