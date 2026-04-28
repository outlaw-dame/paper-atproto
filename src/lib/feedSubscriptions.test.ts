import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addFeedMock } = vi.hoisted(() => ({
  addFeedMock: vi.fn(),
}));

vi.mock('../feeds', () => ({
  feedService: {
    addFeed: addFeedMock,
  },
}));

import { subscribeToExternalFeed } from './feedSubscriptions';

describe('subscribeToExternalFeed', () => {
  beforeEach(() => {
    addFeedMock.mockReset();
  });

  it('rejects invalid urls before touching the feed service', async () => {
    const result = await subscribeToExternalFeed({
      rawUrl: 'javascript:alert(1)',
      category: 'Podcasts',
    });

    expect(result).toEqual({
      ok: false,
      normalizedUrl: null,
      category: 'Podcasts',
      reason: 'invalid_url',
      message: 'Enter a valid http(s) feed URL.',
    });
    expect(addFeedMock).not.toHaveBeenCalled();
  });

  it('retries transient feed subscription failures with bounded backoff', async () => {
    addFeedMock
      .mockRejectedValueOnce(new Error('temporary proxy failure'))
      .mockRejectedValueOnce(new Error('temporary proxy failure'))
      .mockResolvedValueOnce({ feedId: 'feed-1', title: 'Feed', itemCount: 5 });

    const result = await subscribeToExternalFeed({
      rawUrl: 'https://example.com/feed.xml',
      category: 'News',
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(addFeedMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      ok: true,
      normalizedUrl: 'https://example.com/feed.xml',
      category: 'News',
      result: { feedId: 'feed-1', title: 'Feed', itemCount: 5 },
    });
  });

  it('returns a structured failure after exhausting retries', async () => {
    addFeedMock.mockRejectedValue({ status: 503, message: 'temporary proxy failure' });

    const result = await subscribeToExternalFeed({
      rawUrl: 'https://example.com/feed.xml',
      category: 'Podcasts',
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(addFeedMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      normalizedUrl: 'https://example.com/feed.xml',
      category: 'Podcasts',
      reason: 'subscribe_failed',
      message: 'Unable to add this feed right now. Please try again.',
    });
  });

  it('does not retry clearly non-transient subscription failures', async () => {
    addFeedMock.mockRejectedValue({
      status: 400,
      message: 'invalid feed payload',
    });

    const result = await subscribeToExternalFeed({
      rawUrl: 'https://example.com/feed.xml',
      category: 'News',
      maxAttempts: 4,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(addFeedMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      normalizedUrl: 'https://example.com/feed.xml',
      category: 'News',
      reason: 'subscribe_failed',
    });
  });
});
