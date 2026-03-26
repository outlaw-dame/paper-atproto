// ─── UI Store ──────────────────────────────────────────────────────────────
// Owns all transient UI state: active tab, overlay visibility, story entry,
// search story query, and prompt composer.

import { create } from 'zustand';
import type { TabId, StoryEntry } from '../App.js';
import type { MockPost } from '../data/mockData.js';

interface UiState {
  activeTab: TabId;
  prevTab: TabId;
  showCompose: boolean;
  showPromptComposer: boolean;
  /** Post being replied to, or null for a new top-level post. */
  replyTarget: MockPost | null;
  story: StoryEntry | null;
  searchStoryQuery: string | null;
  unreadCount: number;
  profileDid: string | null;
  composeDraft: string;

  // Actions
  setTab: (id: TabId) => void;
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
  setUnreadCount: (n: number) => void;
  openProfile: (did: string) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: 'home' as TabId,
  prevTab: 'home' as TabId,
  showCompose: false,
  showPromptComposer: false,
  replyTarget: null,
  story: null,
  searchStoryQuery: null,
  unreadCount: 0,
  profileDid: null,

  setTab: (id) => set({ prevTab: get().activeTab, activeTab: id }),
  composeDraft: '',
  openCompose: () => set({ showCompose: true, replyTarget: null }),
  openComposeReply: (post) => set({ showCompose: true, replyTarget: post }),
  closeCompose: () => set({ showCompose: false, composeDraft: '', replyTarget: null }),
  setComposeDraft: (text) => set({ composeDraft: text }),
  openPromptComposer: () => set({ showPromptComposer: true }),
  closePromptComposer: () => set({ showPromptComposer: false }),
  openStory: (entry) => set({ story: entry }),
  closeStory: () => set({ story: null }),
  openSearchStory: (query) => set({ searchStoryQuery: query }),
  closeSearchStory: () => set({ searchStoryQuery: null }),
  setUnreadCount: (n) => set({ unreadCount: n }),
  openProfile: (did) => set(s => ({ profileDid: did, prevTab: s.activeTab, activeTab: 'profile' as TabId })),

}));
