import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { AppError } from '../lib/errors.js';

const fetchConversationThreadSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/conversationThreadWatch.js', () => ({
  fetchConversationThreadSnapshot: fetchConversationThreadSnapshotMock,
  normalizeConversationWatchRootUri: (value: unknown) => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return /^at:\/\/[^/]+\/[^/]+\/[^/]+$/.test(normalized) ? normalized : null;
  },
  classifyConversationWatchError: () => ({ code: 'unknown', retryable: true, retryAfterMs: null }),
  computeConversationWatchBackoffMs: () => 1500,
}));

describe('conversationWatchRouter', () => {
  beforeEach(() => {
    fetchConversationThreadSnapshotMock.mockReset();
  });

  async function requestWatch(path) {
    const { conversationWatchRouter } = await import('./conversationWatch.js');
    const app = new Hono();
    app.route('/api/conversation', conversationWatchRouter);
    app.onError((error, c) => {
      if (error instanceof AppError) {
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      return c.json({ error: 'Server error' }, 500);
    });
    return app.request(`/api/conversation${path}`, { method: 'GET' });
  }

  it('streams a ready event for a valid root watch request', async () => {
    fetchConversationThreadSnapshotMock.mockResolvedValue({
      rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
      signature: 'sig-1',
      replyCount: 2,
      nodeCount: 3,
      latestReplyAt: '2026-04-08T16:10:00.000Z',
      observedAt: '2026-04-08T16:11:00.000Z',
    });

    const response = await requestWatch('/watch?rootUri=at://did:plc:root/app.bsky.feed.post/root');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    const text = chunk?.value ? new TextDecoder().decode(chunk.value) : '';

    expect(text).toContain('event: ready');
    expect(text).toContain('"replyCount":2');

    await reader?.cancel();
  });

  it('rejects invalid root watch requests', async () => {
    const response = await requestWatch('/watch?rootUri=not-a-uri');

    expect(response.status).toBe(400);
  });
});
