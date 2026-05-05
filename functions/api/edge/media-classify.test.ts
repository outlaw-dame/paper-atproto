import { describe, expect, it, vi } from 'vitest';

import { onRequest, runWorkersAiMediaClassifier } from './media-classify';

function createContext(body: unknown, aiRun = vi.fn()) {
  return {
    request: new Request('https://example.com/api/edge/media-classify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env: {
      AI: {
        run: aiRun,
      },
    },
  } as any;
}

describe('Cloudflare media-classify function', () => {
  it('runs a vision-capable Workers AI model and normalizes media output', async () => {
    const aiRun = vi.fn(async () => JSON.stringify({
      mediaType: 'screenshot',
      mediaSummary: 'The image shows a revised launch timeline.',
      extractedText: 'Launch moved to Friday',
      candidateEntities: ['Launch timeline'],
      confidence: 0.84,
      cautionFlags: [],
    }));

    const payload = await runWorkersAiMediaClassifier({ run: aiRun }, '@cf/meta/llama-3.2-11b-vision-instruct', {
      threadId: 'at://did:plc:test/app.bsky.feed.post/root',
      mediaUrl: 'https://example.com/timeline.png',
      nearbyText: 'People are comparing a revised launch timeline.',
      candidateEntities: ['Launch timeline', 'Product update'],
      factualHints: ['date moved'],
    });

    expect(aiRun).toHaveBeenCalledWith('@cf/meta/llama-3.2-11b-vision-instruct', expect.objectContaining({
      messages: expect.any(Array),
      response_format: { type: 'json_object' },
    }));
    expect(payload).toMatchObject({
      provider: 'cloudflare-workers-ai',
      model: '@cf/meta/llama-3.2-11b-vision-instruct',
      mediaType: 'screenshot',
      mediaSummary: 'The image shows a revised launch timeline.',
      candidateEntities: ['Launch timeline'],
      analysisStatus: 'complete',
    });
  });

  it('returns a degraded structured response when Workers AI fails', async () => {
    const response = await onRequest(createContext({
      threadId: 'at://did:plc:test/app.bsky.feed.post/root',
      mediaUrl: 'https://example.com/timeline.png',
      nearbyText: 'People are comparing a revised launch timeline.',
      candidateEntities: ['Launch timeline'],
      factualHints: [],
    }, vi.fn().mockRejectedValue(new Error('provider down'))));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      provider: 'cloudflare-workers-ai',
      mediaType: 'unknown',
      analysisStatus: 'degraded',
      cautionFlags: ['workers_ai_failed'],
    });
  });
});