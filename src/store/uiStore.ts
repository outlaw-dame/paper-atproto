// ─── UI Store ──────────────────────────────────────────────────────────────
// Owns all transient UI state: active tab, overlay visibility, story entry,
// search story query, and prompt composer.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MockPost } from '../data/mockData';
import { isAtUri } from '../lib/resolver/atproto';

export type TabId = 'home' | 'explore' | 'compose' | 'activity' | 'profile';
export type HomeFeedMode = 'Following' | 'Discover' | 'Feeds';

export interface StoryEntry {
  type: 'post' | 'topic';
  id: string;
  title: string;
}

const TAB_IDS: readonly TabId[] = ['home', 'explore', 'compose', 'activity', 'profile'] as const;
const HOME_FEED_MODES: readonly HomeFeedMode[] = ['Following', 'Discover', 'Feeds'] as const;
const MAX_QUERY_LENGTH = 200;
const MAX_STORY_ID_LENGTH = 512;
const MAX_STORY_TITLE_LENGTH = 160;
const MAX_PROFILE_DID_LENGTH = 190;

export interface UiResumeState {
  activeTab: TabId;
  prevTab: TabId;
  homeFeedMode: HomeFeedMode;
  profileDid: string | null;
  story: StoryEntry | null;
  exploreSearchQuery: string | null;
  searchStoryQuery: string | null;
  hashtagFeedQuery: string | null;
  peopleFeedQuery: string | null;
}

function clearTransientOverlayResumeState(state: UiResumeState): UiResumeState {
  return {
    ...state,
    // Full-screen overlays and feed drill-ins are intentionally not resumed.
    // Rehydrating them across reloads can reopen stale thread/search state and
    // strand the app inside a crashing surface after a deployment or bug fix.
    story: null,
    searchStoryQuery: null,
    hashtagFeedQuery: null,
    peopleFeedQuery: null,
  };
}

function sanitizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function sanitizeStoryEntry(value: unknown): StoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoryEntry>;
  const type = candidate.type === 'post' || candidate.type === 'topic' ? candidate.type : null;
  const id = sanitizeBoundedString(candidate.id, MAX_STORY_ID_LENGTH);
  const title = sanitizeBoundedString(candidate.title, MAX_STORY_TITLE_LENGTH);
  if (type === 'post' && id && !isAtUri(id)) return null;
  if (!type || !id || !title) return null;
  return { type, id, title };
}

export function sanitizeUiResumeState(value: unknown): UiResumeState {
  const source = value && typeof value === 'object' ? value as Partial<UiResumeState> : {};
  const activeTab = TAB_IDS.includes(source.activeTab as TabId) ? source.activeTab as TabId : 'home';
  const prevTab = TAB_IDS.includes(source.prevTab as TabId) ? source.prevTab as TabId : 'home';
  const homeFeedMode = HOME_FEED_MODES.includes(source.homeFeedMode as HomeFeedMode)
    ? source.homeFeedMode as HomeFeedMode
    : 'Following';
  const profileDid = sanitizeBoundedString(source.profileDid, MAX_PROFILE_DID_LENGTH);

  const sanitized: UiResumeState = {
    activeTab: activeTab === 'profile' && !profileDid ? 'home' : activeTab,
    prevTab,
    homeFeedMode,
    profileDid,
    story: sanitizeStoryEntry(source.story),
    exploreSearchQuery: sanitizeBoundedString(source.exploreSearchQuery, MAX_QUERY_LENGTH),
    searchStoryQuery: sanitizeBoundedString(source.searchStoryQuery, MAX_QUERY_LENGTH),
    hashtagFeedQuery: sanitizeBoundedString(source.hashtagFeedQuery, MAX_QUERY_LENGTH),
    peopleFeedQuery: sanitizeBoundedString(source.peopleFeedQuery, MAX_QUERY_LENGTH),
  };

  return clearTransientOverlayResumeState(sanitized);
}

interface UiState {
  activeTab: TabId;
  prevTab: TabId;
  homeFeedMode: HomeFeedMode;
  showCompose: boolean;
  showPromptComposer: boolean;
  /** Post being replied to, or null for a new top-level post. */
  replyTarget: MockPost | null;
  story: StoryEntry | null;
  searchStoryQuery: string | null;
  exploreSearchQuery: string | null;
  hashtagFeedQuery: string | null;
  peopleFeedQuery: string | null;
  unreadCount: number;
  profileDid: string | null;
  composeDraft: string;

  // Actions
  setTab: (id: TabId) => void;
  setHomeFeedMode: (mode: HomeFeedMode) => void;
  openCompose: () => void;
  openComposeReply: (post: MockPost) => void;
  closeCompose: () => void;
  setComposeDraft: (text: string) => void;
  openPromptComposer: () => void;
  closePromptComposer: () => void;
  openStory: (entry: StoryEntry) => void;
  closeStory: () => void;
  openSearchStory: (query: string) => void;
  closeSearchStory: () => void;
  openExploreSearch: (query: string) => void;
  clearExploreSearch: () => void;
  openHashtagFeed: (hashtag: string) => void;
  closeHashtagFeed: () => void;
  openPeopleFeed: (query: string) => void;
  closePeopleFeed: () => void;
  setUnreadCount: (n: number) => void;
  openProfile: (did: string) => void;
  exploreAiInsightEnabled: boolean;
  toggleExploreAiInsight: () => void;
}

export function selectUiResumeState(state: UiState): UiResumeState {
  return clearTransientOverlayResumeState(sanitizeUiResumeState({
    activeTab: state.activeTab,
    prevTab: state.prevTab,
    homeFeedMode: state.homeFeedMode,
    profileDid: state.profileDid,
    story: state.story,
    exploreSearchQuery: state.exploreSearchQuery,
    searchStoryQuery: state.searchStoryQuery,
    hashtagFeedQuery: state.hashtagFeedQuery,
    peopleFeedQuery: state.peopleFeedQuery,
  }));
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      activeTab: 'home' as TabId,
      prevTab: 'home' as TabId,
      homeFeedMode: 'Following' as HomeFeedMode,
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
      exploreAiInsightEnabled: false,

      setTab: (id) => set({ prevTab: get().activeTab, activeTab: id }),
      setHomeFeedMode: (mode) => set({ homeFeedMode: mode }),
      composeDraft: '',
      openCompose: () => set({ showCompose: true, replyTarget: null }),
      openComposeReply: (post) => set({ showCompose: true, replyTarget: post }),
      closeCompose: () => set({ showCompose: false, composeDraft: '', replyTarget: null }),
      setComposeDraft: (text) => set({ composeDraft: text }),
      openPromptComposer: () => set({ showPromptComposer: true }),
      closePromptComposer: () => set({ showPromptComposer: false }),
      openStory: (entry) => set((state) => {
        const sanitized = sanitizeStoryEntry(entry);
        if (!sanitized) return state;
        if (
          state.story
          && state.story.type === sanitized.type
          && state.story.id === sanitized.id
          && state.story.title === sanitized.title
        ) {
          return state;
        }
        return { story: sanitized };
      }),
      closeStory: () => set({ story: null }),
      openSearchStory: (query) => set({ searchStoryQuery: query }),
      closeSearchStory: () => set({ searchStoryQuery: null }),
      openExploreSearch: (query) => set((s) => ({
        exploreSearchQuery: query,
        searchStoryQuery: null,
        story: null,
        prevTab: s.activeTab,
        activeTab: 'explore' as TabId,
      })),
      clearExploreSearch: () => set({ exploreSearchQuery: null }),
      openHashtagFeed: (hashtag) => set({ hashtagFeedQuery: hashtag }),
      closeHashtagFeed: () => set({ hashtagFeedQuery: null }),
      openPeopleFeed: (query) => set({ peopleFeedQuery: query }),
      closePeopleFeed: () => set({ peopleFeedQuery: null }),
      setUnreadCount: (n) => set({ unreadCount: n }),
      openProfile: (did) => set((s) => ({ profileDid: did, prevTab: s.activeTab, activeTab: 'profile' as TabId })),
      toggleExploreAiInsight: () => set((s) => ({ exploreAiInsightEnabled: !s.exploreAiInsightEnabled })),

    }),
    {
      name: 'glympse.ui.state.v1',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      partialize: selectUiResumeState,
      migrate: (persistedState) => sanitizeUiResumeState(persistedState),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[UiStore] Rehydration error:', error);
        }
      },
    },
  ),
);
