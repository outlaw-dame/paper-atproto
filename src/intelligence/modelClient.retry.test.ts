import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sleepWithAbortMock } = vi.hoisted(() => ({
  sleepWithAbortMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/abortSignals', async () => {
  const actual = await vi.importActual('../lib/abortSignals');
  return {
    ...actual,
    sleepWithAbort: sleepWithAbortMock,
  };
});

import {
  callComposerGuidanceWriter,
  callMediaAnalyzer,
} from './modelClient';

describe('modelClient retry policy', () => {
  beforeEach(() => {
    sleepWithAbortMock.mockClear();
    vi.restoreAllMocks();
  });

  it('does not retry non-retryable 400 responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));

    await expect(callComposerGuidanceWriter({
      mode: 'reply',
      draftText: 'Draft text',
      uiState: 'caution',
      scores: {
        positiveSignal: 0.1,
        negativeSignal: 0.5,
        supportiveness: 0.2,
        constructiveness: 0.5,
        clarifying: 0.2,
        hostility: 0.1,
        dismissiveness: 0.1,
        escalation: 0.1,
        sentimentPositive: 0.1,
        sentimentNegative: 0.2,
        anger: 0.1,
        trust: 0.4,
        optimism: 0.2,
        targetedNegativity: 0.1,
        toxicity: 0.1,
      },
      constructiveSignals: ['Add context'],
      supportiveSignals: [],
      parentSignals: [],
    })).rejects.toThrow(/responded 400/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('retries transient 503 responses with backoff', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        mediaCentrality: 0.7,
        mediaType: 'document',
        mediaSummary: 'A memo screenshot.',
        candidateEntities: ['Agency'],
        confidence: 0.8,
        cautionFlags: [],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callMediaAnalyzer({
      threadId: 'thread-1',
      mediaUrl: 'https://safe.example/image.png',
      nearbyText: 'caption text',
      candidateEntities: ['Agency'],
      factualHints: [],
    });

    expect(result.mediaType).toBe('document');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
  });
});
