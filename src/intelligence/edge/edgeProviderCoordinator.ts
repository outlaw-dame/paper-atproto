import type { IntelligenceRoutingInput, PrivacyMode } from '../intelligenceRoutingPolicy';
import { chooseIntelligenceLane } from '../intelligenceRoutingPolicy';
import type { EdgeExecutionPlan, EdgeProviderId } from './edgeProviderContracts';

const COMPOSER_CLASSIFIER_ENDPOINT = '/api/llm/analyze/composer-classifier';
const DEFAULT_PRIVACY_MODE: PrivacyMode = 'balanced';

export interface EdgeProviderAvailability {
  cloudflareWorkersAi?: boolean;
  nodeHeuristic?: boolean;
}

export interface EdgeProviderCoordinatorOptions {
  availability?: EdgeProviderAvailability;
}

function cloudflareAvailable(options: EdgeProviderCoordinatorOptions): boolean {
  return options.availability?.cloudflareWorkersAi !== false;
}

function nodeHeuristicAvailable(options: EdgeProviderCoordinatorOptions): boolean {
  return options.availability?.nodeHeuristic !== false;
}

function composerProvider(options: EdgeProviderCoordinatorOptions): EdgeProviderId {
  return cloudflareAvailable(options) ? 'cloudflare-workers-ai' : 'node-heuristic';
}

function anyComposerEdgeProviderAvailable(options: EdgeProviderCoordinatorOptions): boolean {
  return cloudflareAvailable(options) || nodeHeuristicAvailable(options);
}

export function planEdgeExecution(
  input: IntelligenceRoutingInput,
  options: EdgeProviderCoordinatorOptions = {},
): EdgeExecutionPlan | null {
  const decision = chooseIntelligenceLane({
    ...input,
    edgeAvailable: input.edgeAvailable ?? anyComposerEdgeProviderAvailable(options),
  });

  if (decision.lane !== 'edge_classifier' && decision.lane !== 'edge_reranker') return null;

  const provider = input.task === 'composer_refine'
    ? composerProvider(options)
    : 'cloudflare-workers-ai';

  return {
    capability: input.task === 'composer_refine' ? 'composer_classify' : 'search_rerank',
    provider,
    endpoint: COMPOSER_CLASSIFIER_ENDPOINT,
    lane: decision.lane,
    task: decision.task,
    privacyMode: input.privacyMode ?? DEFAULT_PRIVACY_MODE,
    sendsPrivateText: decision.sendsPrivateText,
    requiresConsent: decision.requiresConsent,
    maxPayloadChars: decision.maxPayloadChars,
    reasonCode: decision.reasonCode,
    ...(provider === 'cloudflare-workers-ai' ? { fallbackProvider: 'node-heuristic' as const } : {}),
    ...(decision.fallbackLane ? { fallbackLane: decision.fallbackLane } : {}),
  };
}
