import { beforeEach, describe, expect, it } from 'vitest';
import {
  emitConversationHydrationInvalidation,
  resetConversationHydrationInvalidationForTests,
  shouldSelfHealConversationHydration,
  subscribeConversationHydrationInvalidations,
} from './hydrationInvalidation';

describe('hydrationInvalidation', () => {
  beforeEach(() => {
    resetConversationHydrationInvalidationForTests();
  });

  it('delivers sanitized invalidation events to matching subscribers', () => {
    const received: string[] = [];
    const unsubscribe = subscribeConversationHydrationInvalidations(
      { sessionId: 'at://did:plc:root/app.bsky.feed.post/root' },
      (event) => {
        received.push(`${event.reason}:${event.revision}`);
      },
    );

    emitConversationHydrationInvalidation({
      sessionId: 'at://did:plc:root/app.bsky.feed.post/root',
      rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
      reason: 'remote_thread_changed',
      emittedAt: new Date().toISOString(),
    });

    emitConversationHydrationInvalidation({
      sessionId: 'at://did:plc:root/app.bsky.feed.post/root',
      rootUri: 'at://did:plc:root/app.bsky.feed.post/root',
      reason: 'optimistic_reply_inserted',
      revision: 3.8,
    });

    expect(received).toEqual([
      'remote_thread_changed:undefined',
      'optimistic_reply_inserted:3',
    ]);
    unsubscribe();
  });

  it('self-heals when a newer mutation is ahead of the last hydrate', () => {
    expect(shouldSelfHealConversationHydration({
      mutationRevision: 2,
      lastHandledMutationRevision: 1,
      lastMutationAt: '2026-04-08T12:00:05.000Z',
      lastHydratedAt: '2026-04-08T12:00:00.000Z',
    })).toBe(true);

    expect(shouldSelfHealConversationHydration({
      mutationRevision: 2,
      lastHandledMutationRevision: 2,
      lastMutationAt: '2026-04-08T12:00:05.000Z',
      lastHydratedAt: '2026-04-08T12:00:00.000Z',
    })).toBe(false);

    expect(shouldSelfHealConversationHydration({
      mutationRevision: 3,
      lastHandledMutationRevision: 1,
      lastMutationAt: '2026-04-08T12:00:00.000Z',
      lastHydratedAt: '2026-04-08T12:00:05.000Z',
    })).toBe(false);
  });
});
