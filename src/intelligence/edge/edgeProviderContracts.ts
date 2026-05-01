import type { IntelligenceLane, IntelligenceTask, PrivacyMode } from '../intelligenceRoutingPolicy';
import type { ComposerEdgeClassifierRequest, ComposerEdgeClassifierResponse } from '../composer/edgeClassifierContracts';

export type EdgeProviderId = 'cloudflare-workers-ai' | 'node-heuristic';
export type EdgeCapability = 'composer_classify' | 'search_rerank' | 'media_classify' | 'story_summarize';

export interface EdgeExecutionPlan {
  capability: EdgeCapability;
  provider: EdgeProviderId;
  endpoint: string;
  lane: IntelligenceLane;
  task: IntelligenceTask;
  privacyMode: PrivacyMode;
  sendsPrivateText: boolean;
  requiresConsent: boolean;
  maxPayloadChars: number;
  reasonCode: string;
  fallbackProvider?: EdgeProviderId;
  fallbackLane?: IntelligenceLane;
}

export interface ComposerClassifyEdgeRequest {
  capability: 'composer_classify';
  input: ComposerEdgeClassifierRequest;
}

export interface ComposerClassifyEdgeResponse {
  capability: 'composer_classify';
  provider: EdgeProviderId;
  output: ComposerEdgeClassifierResponse;
}
