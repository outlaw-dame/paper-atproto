import { describe, expect, it } from 'vitest';

import {
  normalizeSavedFeeds,
  sanitizeSavedFeed,
} from './accountFeeds';

describe('account feed normalization', () => {
  it('sanitizes a valid saved feed entry', () => {
    const result = sanitizeSavedFeed({
      id: ' abc ',
      type: 'feed',
      value: ' at://did:plc:feed/app.bsky.feed.generator/foo ',
      pinned: true,
    });

    expect(result).toEqual({
      id: 'abc',
      type: 'feed',
      value: 'at://did:plc:feed/app.bsky.feed.generator/foo',
      pinned: true,
    });
  });

  it('rejects unsupported kinds and malformed values', () => {
    expect(sanitizeSavedFeed({ id: 'x', type: 'unknown', value: 'y', pinned: true })).toBeNull();
    expect(sanitizeSavedFeed({ id: '', type: 'feed', value: 'y', pinned: true })).toBeNull();
    expect(sanitizeSavedFeed({ id: 'x', type: 'feed', value: '', pinned: true })).toBeNull();
  });

  it('deduplicates by id and keeps pinned first order', () => {
    const result = normalizeSavedFeeds([
      { id: '1', type: 'feed', value: 'at://feed/1', pinned: false },
      { id: '2', type: 'timeline', value: 'following', pinned: true },
      { id: '1', type: 'feed', value: 'at://feed/1-updated', pinned: true },
      { id: 'bad', type: 'bad-type', value: 'x', pinned: true },
    ]);

    expect(result).toEqual([
      { id: '1', type: 'feed', value: 'at://feed/1-updated', pinned: true },
      { id: '2', type: 'timeline', value: 'following', pinned: true },
    ]);
  });
});
