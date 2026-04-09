import { describe, expect, it, vi } from 'vitest';

import {
  buildConversationThreadWatchUrl,
  computeConversationThreadWatchReconnectDelayMs,
  normalizeConversationThreadInvalidationEvent,
} from './threadWatch';

describe('threadWatch helpers', () => {
  it('builds a same-origin watch URL for a root AT URI', () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://127.0.0.1:3011' },
    } as unknown as Window & typeof globalThis);

    expect(buildConversationThreadWatchUrl('at://did:plc:root/app.bsky.feed.post/root')).toBe(
      'http://127.0.0.1:3011/api/conversation/watch?rootUri=at%3A%2F%2Fdid%3Aplc%3Aroot%2Fapp.bsky.feed.post%2Froot',
    );
  });

  it('sanitizes incoming invalidation events', () => {
    expect(normalizeConversationThreadInvalidationEvent({
      rootUri: ' at://did:plc:root/app.bsky.feed.post/root ',
      reason: 'remote_thread_changed',
      observedAt: '2026-04-08T16:10:00.000Z',
      sequence: 3.8,
      replyCount: 7,
      nodeCount: 8,
      latestReplyAt: '2026-04-08T16:09:00.000Z',
    })).toEqual({
      rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
      reason: 'remote_thread_changed',
      observedAt: '2026-04-08T16:10:00.000Z',
      sequence: 3,
      replyCount: 7,
      nodeCount: 8,
      latestReplyAt: '2026-04-08T16:09:00.000Z',
    });

    expect(normalizeConversationThreadInvalidationEvent({
      rootUri: 'https://example.com',
      reason: 'remote_thread_changed',
      observedAt: '2026-04-08T16:10:00.000Z',
    })).toBeNull();
  });

  it('prefers server-provided reconnect delays before exponential backoff', () => {
    expect(computeConversationThreadWatchReconnectDelayMs(0, 1800)).toBe(1800);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const delay = computeConversationThreadWatchReconnectDelayMs(2, undefined, 1000, 30_000);
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});
