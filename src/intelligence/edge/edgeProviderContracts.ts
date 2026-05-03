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

export interface SearchRerankEdgeRequest {
  capability: 'search_rerank';
  input: unknown;
}

export interface SearchRerankEdgeResponse {
  capability: 'search_rerank';
  provider: EdgeProviderId;
  output: unknown;
}

export interface MediaClassifyEdgeRequest {
  capability: 'media_classify';
  input: unknown;
}

export interface MediaClassifyEdgeResponse {
  capability: 'media_classify';
  provider: EdgeProviderId;
  output: unknown;
}

export interface StorySummarizeEdgeRequest {
  capability: 'story_summarize';
  input: unknown;
}

export interface StorySummarizeEdgeResponse {
  capability: 'story_summarize';
  provider: EdgeProviderId;
  output: unknown;
}

export type EdgeRuntimeRequest =
  | ComposerClassifyEdgeRequest
  | SearchRerankEdgeRequest
  | MediaClassifyEdgeRequest
  | StorySummarizeEdgeRequest;

export type EdgeRuntimeResponse =
  | ComposerClassifyEdgeResponse
  | SearchRerankEdgeResponse
  | MediaClassifyEdgeResponse
  | StorySummarizeEdgeResponse;
