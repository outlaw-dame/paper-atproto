import { describe, expect, it } from 'vitest';

import { planEdgeExecution } from './edgeProviderCoordinator';

describe('edge provider task planning', () => {
  it('plans composer classification with Cloudflare and node fallback when both are available', () => {
    expect(planEdgeExecution({
      task: 'composer_refine',
      dataScope: 'private_draft',
      privacyMode: 'balanced',
    })).toMatchObject({
      capability: 'composer_classify',
      provider: 'cloudflare-workers-ai',
      endpoint: '/api/llm/analyze/composer-classifier',
      fallbackProvider: 'node-heuristic',
    });
  });

  it('uses node heuristic for composer classification when Cloudflare is unavailable', () => {
    expect(planEdgeExecution({
      task: 'composer_refine',
      dataScope: 'private_draft',
      privacyMode: 'balanced',
    }, {
      availability: {
        cloudflareWorkersAi: false,
        nodeHeuristic: true,
      },
    })).toMatchObject({
      capability: 'composer_classify',
      provider: 'node-heuristic',
      endpoint: '/api/llm/analyze/composer-classifier',
    });
  });

  it('does not add a node fallback when node heuristic is unavailable', () => {
    const plan = planEdgeExecution({
      task: 'composer_refine',
      dataScope: 'private_draft',
      privacyMode: 'balanced',
    }, {
      availability: {
        cloudflareWorkersAi: true,
        nodeHeuristic: false,
      },
    });

    expect(plan?.provider).toBe('cloudflare-workers-ai');
    expect(plan).not.toHaveProperty('fallbackProvider');
  });

  it('does not plan composer edge execution when all composer edge providers are unavailable', () => {
    expect(planEdgeExecution({
      task: 'composer_refine',
      dataScope: 'private_draft',
      privacyMode: 'balanced',
    }, {
      availability: {
        cloudflareWorkersAi: false,
        nodeHeuristic: false,
      },
    })).toBeNull();
  });

  it('plans public search reranking with the search endpoint only when Cloudflare is available', () => {
    expect(planEdgeExecution({
      task: 'public_search',
      dataScope: 'public_corpus',
      privacyMode: 'balanced',
    })).toMatchObject({
      capability: 'search_rerank',
      provider: 'cloudflare-workers-ai',
      endpoint: '/api/llm/rerank/search',
    });

    expect(planEdgeExecution({
      task: 'public_search',
      dataScope: 'public_corpus',
      privacyMode: 'balanced',
    }, {
      availability: {
        cloudflareWorkersAi: false,
        nodeHeuristic: true,
      },
    })).toBeNull();
  });

  it('maps media analysis and story summary to their own capabilities and endpoints', () => {
    expect(planEdgeExecution({
      task: 'media_analysis',
      dataScope: 'public_corpus',
      privacyMode: 'balanced',
    })).toMatchObject({
      capability: 'media_classify',
      endpoint: '/api/llm/analyze/media',
    });

    expect(planEdgeExecution({
      task: 'story_summary',
      dataScope: 'public_corpus',
      privacyMode: 'balanced',
      edgeAvailable: true,
    })).toBeNull();
  });
});
