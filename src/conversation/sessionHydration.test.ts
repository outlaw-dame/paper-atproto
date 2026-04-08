import { describe, expect, it } from 'vitest';
import {
  collectConversationHydrationTargets,
  shouldAllowEventDrivenHydrationRefresh,
} from './sessionHydration';

describe('collectConversationHydrationTargets', () => {
  it('deduplicates AT URIs in first-seen order and drops invalid values', () => {
    expect(
      collectConversationHydrationTargets([
        'at://did:plc:alice/app.bsky.feed.post/1',
        'not-a-uri',
        'at://did:plc:bob/app.bsky.feed.post/2',
        'at://did:plc:alice/app.bsky.feed.post/1',
        '',
      ]),
    ).toEqual([
      'at://did:plc:alice/app.bsky.feed.post/1',
      'at://did:plc:bob/app.bsky.feed.post/2',
    ]);
  });

  it('respects the requested target limit', () => {
    expect(
      collectConversationHydrationTargets([
        'at://did:plc:one/app.bsky.feed.post/1',
        'at://did:plc:two/app.bsky.feed.post/2',
        'at://did:plc:three/app.bsky.feed.post/3',
      ], 2),
    ).toEqual([
      'at://did:plc:one/app.bsky.feed.post/1',
      'at://did:plc:two/app.bsky.feed.post/2',
    ]); 
  });

  it('throttles event-driven refreshes until the minimum interval elapses', () => {
    expect(shouldAllowEventDrivenHydrationRefresh(0, 5_000, 10_000)).toBe(true);
    expect(shouldAllowEventDrivenHydrationRefresh(5_000, 12_000, 10_000)).toBe(false);
    expect(shouldAllowEventDrivenHydrationRefresh(5_000, 15_000, 10_000)).toBe(true);
  });
});
