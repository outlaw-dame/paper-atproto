import type { IntelligenceRoutingInput, IntelligenceTask, PrivacyMode } from '../intelligenceRoutingPolicy';
import { chooseIntelligenceLane } from '../intelligenceRoutingPolicy';
import type { EdgeCapability, EdgeExecutionPlan, EdgeProviderId } from './edgeProviderContracts';

const COMPOSER_CLASSIFIER_ENDPOINT = '/api/llm/analyze/composer-classifier';
const DEFAULT_PRIVACY_MODE: PrivacyMode = 'balanced';

type EdgeCapabilityPlan = {
  capability: EdgeCapability;
  endpoint: string;
  provider: EdgeProviderId;
  fallbackProvider?: EdgeProviderId;
};

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

function isEdgeAvailableForTask(
  task: IntelligenceTask,
  options: EdgeProviderCoordinatorOptions,
): boolean {
  const plan = resolveCapabilityPlan(task, options);
  return plan !== null;
}

function resolveCapabilityPlan(
  task: IntelligenceTask,
  options: EdgeProviderCoordinatorOptions,
): EdgeCapabilityPlan | null {
  if (task === 'composer_refine') {
    if (cloudflareAvailable(options)) {
      return {
        capability: 'composer_classify',
        endpoint: COMPOSER_CLASSIFIER_ENDPOINT,
        provider: 'cloudflare-workers-ai',
        ...(nodeHeuristicAvailable(options) ? { fallbackProvider: 'node-heuristic' as const } : {}),
      };
    }

    if (nodeHeuristicAvailable(options)) {
      return {
        capability: 'composer_classify',
        endpoint: COMPOSER_CLASSIFIER_ENDPOINT,
        provider: 'node-heuristic',
      };
    }

    return null;
  }

  if (task === 'local_search' || task === 'public_search') {
    return cloudflareAvailable(options)
      ? {
        capability: 'search_rerank',
        endpoint: '/api/llm/rerank/search',
        provider: 'cloudflare-workers-ai',
      }
      : null;
  }

  if (task === 'media_analysis') {
    return cloudflareAvailable(options)
      ? {
        capability: 'media_classify',
        endpoint: '/api/llm/analyze/media',
        provider: 'cloudflare-workers-ai',
      }
      : null;
  }

  if (task === 'story_summary') {
    return cloudflareAvailable(options)
      ? {
        capability: 'story_summarize',
        endpoint: '/api/llm/summarize/story',
        provider: 'cloudflare-workers-ai',
      }
      : null;
  }

  return null;
}

export function planEdgeExecution(
  input: IntelligenceRoutingInput,
  options: EdgeProviderCoordinatorOptions = {},
): EdgeExecutionPlan | null {
  const decision = chooseIntelligenceLane({
    ...input,
    edgeAvailable: input.edgeAvailable ?? isEdgeAvailableForTask(input.task, options),
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
