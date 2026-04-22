import { describe, expect, it } from 'vitest';

import {
  sanitizeFeedCacheEntry,
  sanitizePersistedFeedCacheState,
} from './feedCacheStore';

describe('feedCacheStore persistence hygiene', () => {
  it('drops stale cache entries and bounds persisted metadata', () => {
    const now = new Date('2026-04-02T00:00:00.000Z').getTime();
    const state = sanitizePersistedFeedCacheState({
      caches: {
        'did:plc:user:Following': {
          posts: [{ id: 'p1' }],
          scrollPosition: 140,
          topVisibleIndex: 2,
          unreadCount: 3,
          savedAt: now,
          isInvalidated: false,
        },
        'did:plc:user:Discover': {
          posts: [{ id: 'stale' }],
          scrollPosition: 99,
          topVisibleIndex: 0,
          unreadCount: 0,
          savedAt: now - (1000 * 60 * 60 + 1),
          isInvalidated: false,
        },
      },
      currentAccountDid: ' did:plc:user ',
      currentMode: ' Following ',
    }, now);

    expect(Object.keys(state.caches)).toEqual(['did:plc:user:Following']);
    expect(state.currentAccountDid).toBe('did:plc:user');
    expect(state.currentMode).toBe('Following');
  });

  it('clamps malformed cache metadata to safe values', () => {
    const now = new Date('2026-04-02T00:00:00.000Z').getTime();
    const entry = sanitizeFeedCacheEntry({
      posts: [{ id: 'p1' }],
      cursor: '  cursor-token  ',
      scrollPosition: -12,
      topVisibleIndex: -4,
      unreadCount: 999999,
      topVisiblePostId: '  p1  ',
      savedAt: now,
      isInvalidated: 'nope',
    }, now);

    expect(entry).toMatchObject({
      cursor: 'cursor-token',
      scrollPosition: 0,
      topVisibleIndex: 0,
      unreadCount: 10000,
      topVisiblePostId: 'p1',
      isInvalidated: false,
    });
  });
});