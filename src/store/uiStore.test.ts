import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeUiResumeState, selectUiResumeState, useUiStore } from './uiStore';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('uiStore resume state', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    useUiStore.setState({
      activeTab: 'home',
      prevTab: 'home',
      homeFeedMode: 'Following',
      showCompose: false,
      showPromptComposer: false,
      replyTarget: null,
      story: null,
      searchStoryQuery: null,
      exploreSearchQuery: null,
      hashtagFeedQuery: null,
      peopleFeedQuery: null,
      unreadCount: 0,
      profileDid: null,
      composeDraft: '',
    });
  });

  it('tracks and updates persisted home feed mode', () => {
    useUiStore.getState().setHomeFeedMode('Following');
    expect(useUiStore.getState().homeFeedMode).toBe('Following');

    useUiStore.getState().setHomeFeedMode('Feeds');
    expect(useUiStore.getState().homeFeedMode).toBe('Feeds');
  });

  it('remembers app location by active tab and profile target', () => {
    useUiStore.getState().setTab('activity');
    expect(useUiStore.getState().activeTab).toBe('activity');
    expect(useUiStore.getState().prevTab).toBe('home');

    useUiStore.getState().openProfile('did:plc:resume0001');
    expect(useUiStore.getState().activeTab).toBe('profile');
    expect(useUiStore.getState().profileDid).toBe('did:plc:resume0001');
    expect(useUiStore.getState().prevTab).toBe('activity');
  });

  it('persists stable navigation state but clears transient overlays', () => {
    useUiStore.setState({
      activeTab: 'profile',
      prevTab: 'explore',
      homeFeedMode: 'Feeds',
      profileDid: 'did:plc:resume0002',
      story: { type: 'post', id: 'at://did:plc:resume0002/app.bsky.feed.post/1', title: 'Resume thread' },
      searchStoryQuery: 'world cup',
      exploreSearchQuery: '#mlb',
      hashtagFeedQuery: 'mlb',
      peopleFeedQuery: 'baseball writers',
    });

    const persistedState = selectUiResumeState(useUiStore.getState());
    expect(persistedState).toMatchObject({
      activeTab: 'profile',
      prevTab: 'explore',
      homeFeedMode: 'Feeds',
      profileDid: 'did:plc:resume0002',
      story: null,
      exploreSearchQuery: '#mlb',
      searchStoryQuery: null,
      hashtagFeedQuery: null,
      peopleFeedQuery: null,
    });
  });

  it('sanitizes malformed persisted resume state before reuse', () => {
    expect(sanitizeUiResumeState({
      activeTab: 'profile',
      prevTab: 'bogus',
      homeFeedMode: 'bogus',
      profileDid: '   ',
      story: { type: 'bogus', id: '', title: '' },
      exploreSearchQuery: '  #mlb  ',
    })).toEqual({
      activeTab: 'home',
      prevTab: 'home',
      homeFeedMode: 'Following',
      feedsAdaptiveRanking: false,
      profileDid: null,
      story: null,
      exploreSearchQuery: '#mlb',
      searchStoryQuery: null,
      hashtagFeedQuery: null,
      peopleFeedQuery: null,
    });
  });
});
