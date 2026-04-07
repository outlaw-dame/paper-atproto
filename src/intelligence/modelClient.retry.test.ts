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
  callInterpolatorWriter,
  callComposerGuidanceWriter,
  callMediaAnalyzer,
} from './modelClient';
import type { ThreadStateForWriter } from './llmContracts';

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

  it('falls back when model output echoes a long root-post phrase', async () => {
    const writerInput: ThreadStateForWriter = {
      threadId: 'thread-echo',
      summaryMode: 'descriptive_fallback',
      confidence: {
        surfaceConfidence: 0.68,
        entityConfidence: 0.63,
        interpretiveConfidence: 0.55,
      },
      visibleReplyCount: 5,
      rootPost: {
        uri: 'at://did:plc:author/app.bsky.feed.post/root',
        handle: 'author.test',
        text: 'City officials quietly rewrote the emergency housing policy overnight without public notice and residents are asking for source documents.',
        createdAt: '2026-04-07T00:00:00.000Z',
      },
      selectedComments: [
        {
          uri: 'at://did:plc:r1/app.bsky.feed.post/1',
          handle: 'reply.one',
          text: 'One reply cites the archived policy PDF and points to deleted language.',
          impactScore: 0.78,
          role: 'source_bringer',
        },
        {
          uri: 'at://did:plc:r2/app.bsky.feed.post/2',
          handle: 'reply.two',
          text: 'Another asks why no public hearing happened before the change.',
          impactScore: 0.66,
          role: 'clarifying',
        },
        {
          uri: 'at://did:plc:r3/app.bsky.feed.post/3',
          handle: 'reply.three',
          text: 'A third commenter disputes whether the revision happened overnight.',
          impactScore: 0.61,
          role: 'useful_counterpoint',
        },
      ],
      topContributors: [],
      safeEntities: [{ id: 'housing-policy', label: 'Emergency housing policy', type: 'topic', confidence: 0.91, impact: 0.82 }],
      factualHighlights: ['Replies reference archived policy language and meeting records.'],
      whatChangedSignals: ['source cited: archived policy text', 'clarification: timeline challenged'],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        collapsedSummary: 'City officials quietly rewrote the emergency housing policy overnight without public notice and residents are asking for source documents.',
        whatChanged: ['source cited: archived policy text'],
        contributorBlurbs: [{ handle: 'reply.one', blurb: 'Cites archived language.' }],
        abstained: false,
        mode: 'descriptive_fallback',
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await callInterpolatorWriter(writerInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.abstained).toBe(false);
    expect(result.collapsedSummary.toLowerCase()).toContain('@author.test');
    expect(result.collapsedSummary.toLowerCase()).not.toContain('quietly rewrote the emergency housing policy overnight without public notice');
  });
});
