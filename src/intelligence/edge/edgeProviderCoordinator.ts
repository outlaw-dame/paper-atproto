import type { IntelligenceRoutingInput, IntelligenceTask, PrivacyMode } from '../intelligenceRoutingPolicy';
import { chooseIntelligenceLane } from '../intelligenceRoutingPolicy';
import type { EdgeCapability, EdgeExecutionPlan, EdgeProviderId } from './edgeProviderContracts';

const DEFAULT_PRIVACY_MODE: PrivacyMode = 'balanced';
const ENDPOINTS = {
  composer: '/api/llm/analyze/composer-classifier',
  search: '/api/llm/rerank/search',
  media: '/api/llm/analyze/media',
  story: '/api/llm/summarize/story',
} as const;

type EdgeCoordinatorInput = Omit<IntelligenceRoutingInput, 'edgeAvailable'> & {
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

export interface EdgeProviderCoordinatorOptions {
  availability?: EdgeProviderAvailability;
}

function cloudflareAvailable(options: EdgeProviderCoordinatorOptions): boolean {
  return options.availability?.cloudflareWorkersAi !== false;
}

function nodeHeuristicAvailable(options: EdgeProviderCoordinatorOptions): boolean {
  return options.availability?.nodeHeuristic !== false;
}

function resolveCapabilityPlan(task: IntelligenceTask, options: EdgeProviderCoordinatorOptions): EdgeCapabilityPlan | null {
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
  if (task === 'story_summary') {
    return { capability: 'story_summarize', endpoint: ENDPOINTS.story, provider: 'cloudflare-workers-ai' };
  }
  return null;
}

function isEdgeAvailableForTask(task: IntelligenceTask, options: EdgeProviderCoordinatorOptions): boolean {
  return resolveCapabilityPlan(task, options) !== null;
}

function normalizeEdgeAvailable(input: EdgeCoordinatorInput, options: EdgeProviderCoordinatorOptions): boolean {
  return typeof input.edgeAvailable === 'boolean'
    ? input.edgeAvailable
    : isEdgeAvailableForTask(input.task, options);
}

export function planEdgeExecution(
  input: EdgeCoordinatorInput,
  options: EdgeProviderCoordinatorOptions = {},
): EdgeExecutionPlan | null {
  const decision = chooseIntelligenceLane({
    ...input,
    edgeAvailable: normalizeEdgeAvailable(input, options),
  });
  if (decision.lane !== 'edge_classifier' && decision.lane !== 'edge_reranker') return null;

  const capabilityPlan = resolveCapabilityPlan(input.task, options);
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
