import type { IntelligenceRoutingInput, IntelligenceTask, PrivacyMode } from '../intelligenceRoutingPolicy';
import { chooseIntelligenceLane } from '../intelligenceRoutingPolicy';
import type { EdgeCapability, EdgeExecutionPlan, EdgeProviderId } from './edgeProviderContracts';

const DEFAULT_PRIVACY_MODE: PrivacyMode = 'balanced';
const ENDPOINTS = {
  composer: '/api/llm/analyze/composer-classifier',
  search: '/api/llm/rerank/search',
  media: '/api/llm/analyze/media',
} as const;

type EdgePlannerInput = Omit<IntelligenceRoutingInput, 'edgeAvailable'> & {
  edgeAvailable?: unknown;
};

type EdgeCapabilityPlan = {
  capability: EdgeCapability;
  endpoint: string;
  provider: EdgeProviderId;
  fallbackProvider?: EdgeProviderId;
};

export interface EdgeProviderAvailability {
  cloudflareWorkersAi?: boolean | undefined;
  nodeHeuristic?: boolean | undefined;
}

export interface EdgeProviderPlannerOptions {
  availability?: EdgeProviderAvailability;
}

function cloudflareAvailable(options: EdgeProviderPlannerOptions): boolean {
  return options.availability?.cloudflareWorkersAi !== false;
}

function nodeHeuristicAvailable(options: EdgeProviderPlannerOptions): boolean {
  return options.availability?.nodeHeuristic !== false;
}

function resolveCapabilityPlan(task: IntelligenceTask, options: EdgeProviderPlannerOptions): EdgeCapabilityPlan | null {
  if (task === 'composer_refine') {
    if (cloudflareAvailable(options)) {
      return {
        capability: 'composer_classify',
        endpoint: ENDPOINTS.composer,
        provider: 'cloudflare-workers-ai',
        ...(nodeHeuristicAvailable(options) ? { fallbackProvider: 'node-heuristic' as const } : {}),
      };
    }
    return nodeHeuristicAvailable(options)
      ? { capability: 'composer_classify', endpoint: ENDPOINTS.composer, provider: 'node-heuristic' }
      : null;
  }

  if (!cloudflareAvailable(options)) return null;
  if (task === 'local_search' || task === 'public_search') {
    return { capability: 'search_rerank', endpoint: ENDPOINTS.search, provider: 'cloudflare-workers-ai' };
  }
  if (task === 'media_analysis') {
    return { capability: 'media_classify', endpoint: ENDPOINTS.media, provider: 'cloudflare-workers-ai' };
  }
  return null;
}

function normalizeEdgeAvailable(
  input: EdgePlannerInput,
  capabilityPlan: EdgeCapabilityPlan | null,
): boolean {
  return typeof input.edgeAvailable === 'boolean'
    ? input.edgeAvailable
    : capabilityPlan !== null;
}

export function planEdgeExecution(
  input: EdgePlannerInput,
  options: EdgeProviderPlannerOptions = {},
): EdgeExecutionPlan | null {
  const capabilityPlan = resolveCapabilityPlan(input.task, options);
  const decision = chooseIntelligenceLane({
    ...input,
    edgeAvailable: normalizeEdgeAvailable(input, capabilityPlan),
  });
  if (decision.lane !== 'edge_classifier' && decision.lane !== 'edge_reranker') return null;
  if (!capabilityPlan) return null;

  return {
    capability: capabilityPlan.capability,
    provider: capabilityPlan.provider,
    endpoint: capabilityPlan.endpoint,
    lane: decision.lane,
    task: decision.task,
    privacyMode: input.privacyMode ?? DEFAULT_PRIVACY_MODE,
    sendsPrivateText: decision.sendsPrivateText,
    requiresConsent: decision.requiresConsent,
    maxPayloadChars: decision.maxPayloadChars,
    reasonCode: decision.reasonCode,
    ...(capabilityPlan.fallbackProvider ? { fallbackProvider: capabilityPlan.fallbackProvider } : {}),
    ...(decision.fallbackLane ? { fallbackLane: decision.fallbackLane } : {}),
  };
}
