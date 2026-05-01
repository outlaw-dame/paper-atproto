export type EdgeProviderId = 'cloudflare-workers-ai' | 'node-heuristic';
export type EdgeCapability = 'composer_classify' | 'search_rerank' | 'media_classify' | 'story_summarize';

export interface EdgeExecutionPlan {
  capability: EdgeCapability;
  provider: EdgeProviderId;
  endpoint: string;
  lane: string;
  task: string;
  reasonCode: string;
}
