import type { IntelligenceLane, IntelligenceTask, PrivacyMode } from '../intelligenceRoutingPolicy';
import type { ComposerEdgeClassifierRequest, ComposerEdgeClassifierResponse } from '../composer/edgeClassifierContracts';
import type { MediaAnalysisRequest, MediaAnalysisResult } from '../llmContracts';

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
  input: SearchRerankRequestPayload;
}

export interface SearchRerankEdgeResponse {
  capability: 'search_rerank';
  provider: EdgeProviderId;
  output: SearchRerankResponsePayload;
}

export interface MediaClassifyEdgeRequest {
  capability: 'media_classify';
  input: MediaAnalysisRequest;
}

export interface MediaClassifyEdgeResponse {
  capability: 'media_classify';
  provider: EdgeProviderId;
  output: MediaAnalysisResult;
}

export interface SearchRerankCandidate {
  id: string;
  text: string;
  lexicalScore?: number | undefined;
  semanticScore?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface SearchRerankRequestPayload {
  query: string;
  candidates: SearchRerankCandidate[];
  limit?: number | undefined;
  locale?: string | undefined;
}

export interface SearchRerankResultItem {
  id: string;
  score: number;
  reason?: string | undefined;
}

export interface SearchRerankResponsePayload {
  results: SearchRerankResultItem[];
  model?: string | undefined;
}

export interface StorySummarizeEdgeRequest {
  capability: 'story_summarize';
  // TODO(item-12): replace with concrete story summarize request contract.
  input: Record<string, unknown>;
}

export interface StorySummarizeEdgeResponse {
  capability: 'story_summarize';
  provider: EdgeProviderId;
  // TODO(item-12): replace with concrete story summarize response contract.
  output: Record<string, unknown>;
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
