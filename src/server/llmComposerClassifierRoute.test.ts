import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunComposerClassifier,
} = vi.hoisted(() => ({
  mockRunComposerClassifier: vi.fn(),
}));

vi.mock('../../server/src/services/composerClassifier.js', () => ({
  runComposerClassifier: mockRunComposerClassifier,
}));

import { composerClassifierRouter } from '../../server/src/routes/composerClassifier.js';

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'reply',
    draftText: 'You are wrong but I can explain why with a source.',
    parentText: 'This seems false to me.',
    targetText: '@example.test',
    contextSignals: ['Thread is somewhat heated.'],
    ...overrides,
  };
}

describe('composerClassifierRouter /', () => {
  beforeEach(() => {
    mockRunComposerClassifier.mockReset();
    mockRunComposerClassifier.mockResolvedValue({
      provider: 'edge-heuristic',
      model: 'composer-edge-classifier-v1',
      confidence: 0.72,
      toolsUsed: ['edge-classifier', 'sentiment-polarity', 'emotion', 'targeted-sentiment', 'quality-score'],
      ml: {
        sentiment: {
          label: 'negative',
          confidence: 0.44,
        },
        emotions: [
          { label: 'anger', score: 0.31 },
          { label: 'trust', score: 0.2 },
        ],
        targetedTone: {
          label: 'negative_or_neutral',
          confidence: 0.36,
        },
        conversationQuality: {
          constructive: 0.44,
          supportive: 0.08,
          clarifying: 0.18,
          dismissive: 0.18,
          hostile: 0.28,
          escalating: 0.25,
        },
      },
      abuseScore: null,
    });
  });

  it('returns a bounded classifier payload without generated writer copy', async () => {
    const response = await composerClassifierRouter.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody()),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    const payload = await response.json();
    expect(payload).toMatchObject({
      provider: 'edge-heuristic',
      model: 'composer-edge-classifier-v1',
      confidence: 0.72,
      ml: {
        sentiment: {
          label: 'negative',
          confidence: 0.44,
        },
      },
      abuseScore: null,
    });
    expect(payload).not.toHaveProperty('message');
    expect(payload).not.toHaveProperty('suggestion');
    expect(payload).not.toHaveProperty('badges');
    expect(mockRunComposerClassifier).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'reply',
      draftText: 'You are wrong but I can explain why with a source.',
    }));
  });

  it('rejects invalid classifier requests before calling the service', async () => {
    const response = await composerClassifierRouter.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody({ draftText: '' })),
    });

    expect(response.status).toBe(400);
    expect(mockRunComposerClassifier).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      error: 'Invalid request',
    });
  });

  it('fails closed when service output does not match the response schema', async () => {
    mockRunComposerClassifier.mockResolvedValueOnce({
      provider: 'edge-heuristic',
      model: 'composer-edge-classifier-v1',
      confidence: 2,
      toolsUsed: ['edge-classifier'],
      ml: {},
      abuseScore: null,
    });

    const response = await composerClassifierRouter.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody()),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'LLM output failed schema validation',
    });
  });
});
