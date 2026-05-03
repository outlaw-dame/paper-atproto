import { describe, expect, it, vi } from 'vitest';

import { useAccountFeedsStore } from './accountFeedsStore';

function resetStore(): void {
  useAccountFeedsStore.setState({
    byDid: {},
    selectedFeedIdByDid: {},
  });
}

describe('accountFeedsStore', () => {
  it('hydrates account sources and auto-selects pinned feed', () => {
    resetStore();
    const state = useAccountFeedsStore.getState();

    state.hydrateForDid('did:plc:alice', [
      { id: 'b', kind: 'feed', value: 'at://feed/b', pinned: false, title: 'B' },
      { id: 'a', kind: 'feed', value: 'at://feed/a', pinned: true, title: 'A' },
    ]);

    const next = useAccountFeedsStore.getState();
    expect(next.getSources('did:plc:alice').map((item) => item.id)).toEqual(['b', 'a']);
    expect(next.getSelectedFeedId('did:plc:alice')).toBe('a');
  });

  it('marks stale and validates selected feed ids', () => {
    resetStore();
    const state = useAccountFeedsStore.getState();

    state.hydrateForDid('did:plc:bob', [
      { id: 'one', kind: 'timeline', value: 'following', pinned: true, title: 'Following' },
    ]);
    state.markStale('did:plc:bob');

    const staleState = useAccountFeedsStore.getState();
    expect(staleState.isStale('did:plc:bob')).toBe(true);

    staleState.setSelectedFeedId('did:plc:bob', 'missing');
    expect(useAccountFeedsStore.getState().getSelectedFeedId('did:plc:bob')).toBe('one');
  });

  it('treats entries as stale after TTL', () => {
    resetStore();
    const now = new Date('2026-05-03T00:00:00.000Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const state = useAccountFeedsStore.getState();
    state.hydrateForDid('did:plc:ttl', [
      { id: 'feed', kind: 'feed', value: 'at://feed/ttl', pinned: true, title: 'TTL Feed' },
    ]);

    vi.advanceTimersByTime(1000 * 60 * 21);
    expect(useAccountFeedsStore.getState().isStale('did:plc:ttl')).toBe(true);

    vi.useRealTimers();
  });
});
