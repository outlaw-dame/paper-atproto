import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildConversationThreadSnapshot,
  classifyConversationWatchError,
  computeConversationWatchBackoffMs,
  fetchConversationThreadSnapshot,
  normalizeConversationWatchRootUri,
} from './conversationThreadWatch.js';

describe('conversationThreadWatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes and validates AT URIs for watch requests', () => {
    expect(normalizeConversationWatchRootUri(' at://did:plc:alice/app.bsky.feed.post/1 ')).toBe(
      'at://did:plc:alice/app.bsky.feed.post/1',
    );
    expect(normalizeConversationWatchRootUri('https://example.com')).toBeNull();
  });

  it('builds stable thread signatures regardless of reply ordering', () => {
    const left = buildConversationThreadSnapshot(
      'at://did:plc:root/app.bsky.feed.post/root',
      {
        thread: {
          post: {
            uri: 'at://did:plc:root/app.bsky.feed.post/root',
            cid: 'cid-root',
            replyCount: 2,
            indexedAt: '2026-04-08T16:00:00.000Z',
          },
          replies: [
            {
              post: {
                uri: 'at://did:plc:reply/app.bsky.feed.post/1',
                cid: 'cid-1',
                replyCount: 0,
                indexedAt: '2026-04-08T16:05:00.000Z',
              },
              replies: [],
            },
            {
              post: {
                uri: 'at://did:plc:reply/app.bsky.feed.post/2',
                cid: 'cid-2',
                replyCount: 0,
                indexedAt: '2026-04-08T16:06:00.000Z',
              },
              replies: [],
            },
          ],
        },
      },
      '2026-04-08T16:10:00.000Z',
    );

    const right = buildConversationThreadSnapshot(
      'at://did:plc:root/app.bsky.feed.post/root',
      {
        thread: {
          post: {
            uri: 'at://did:plc:root/app.bsky.feed.post/root',
            cid: 'cid-root',
            replyCount: 2,
            indexedAt: '2026-04-08T16:00:00.000Z',
          },
          replies: [
            {
              post: {
                uri: 'at://did:plc:reply/app.bsky.feed.post/2',
                cid: 'cid-2',
                replyCount: 0,
                indexedAt: '2026-04-08T16:06:00.000Z',
              },
              replies: [],
            },
            {
              post: {
                uri: 'at://did:plc:reply/app.bsky.feed.post/1',
                cid: 'cid-1',
                replyCount: 0,
                indexedAt: '2026-04-08T16:05:00.000Z',
              },
              replies: [],
            },
          ],
        },
      },
      '2026-04-08T16:10:00.000Z',
    );

    expect(left.signature).toBe(right.signature);
    expect(left.replyCount).toBe(2);
    expect(left.nodeCount).toBe(3);
    expect(left.latestReplyAt).toBe('2026-04-08T16:06:00.000Z');
  });

  it('honors retry-after hints when computing backoff', () => {
    const delay = computeConversationWatchBackoffMs(2, {
      status: 429,
      headers: new Headers({ 'retry-after': '3' }),
    });

    expect(delay).toBe(3000);
    expect(classifyConversationWatchError({
      status: 429,
      headers: new Headers({ 'retry-after': '3' }),
    })).toEqual({
      code: 'rate_limited',
      retryable: true,
      retryAfterMs: 3000,
    });
  });

  it('fetches and normalizes thread snapshots from AppView', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      thread: {
        post: {
          uri: 'at://did:plc:root/app.bsky.feed.post/root',
          cid: 'cid-root',
          replyCount: 1,
          indexedAt: '2026-04-08T16:00:00.000Z',
        },
        replies: [
          {
            post: {
              uri: 'at://did:plc:reply/app.bsky.feed.post/1',
              cid: 'cid-1',
              replyCount: 0,
              indexedAt: '2026-04-08T16:05:00.000Z',
            },
            replies: [],
          },
        ],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const snapshot = await fetchConversationThreadSnapshot('at://did:plc:root/app.bsky.feed.post/root');
    expect(snapshot.replyCount).toBe(1);
    expect(snapshot.nodeCount).toBe(2);
    expect(snapshot.signature.length).toBeGreaterThanOrEqual(32);
  });
});
