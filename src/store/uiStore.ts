// ─── UI Store ──────────────────────────────────────────────────────────────
// Owns all transient UI state: active tab, overlay visibility, story entry,
// search story query, and prompt composer.

import { create } from 'zustand';
import type { TabId, StoryEntry } from '../App';

interface UiState {
  activeTab: TabId;
  prevTab: TabId;
  showCompose: boolean;
  showPromptComposer: boolean;
  story: StoryEntry | null;
  searchStoryQuery: string | null;
  unreadCount: number;

  // Actions
  setTab: (id: TabId) => void;
  openCompose: () => void;
  closeCompose: () => void;
  openPromptComposer: () => void;
  closePromptComposer: () => void;
  openStory: (entry: StoryEntry) => void;
  closeStory: () => void;
  openSearchStory: (query: string) => void;
  closeSearchStory: () => void;
  setUnreadCount: (n: number) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: 'home' as TabId,
  prevTab: 'home' as TabId,
  showCompose: false,
  showPromptComposer: false,
  story: null,
  searchStoryQuery: null,
  unreadCount: 0,

  setTab: (id) => set({ prevTab: get().activeTab, activeTab: id }),
  openCompose: () => set({ showCompose: true }),
  closeCompose: () => set({ showCompose: false }),
  openPromptComposer: () => set({ showPromptComposer: true }),
  closePromptComposer: () => set({ showPromptComposer: false }),
  openStory: (entry) => set({ story: entry }),
  closeStory: () => set({ story: null }),
  openSearchStory: (query) => set({ searchStoryQuery: query }),
  closeSearchStory: () => set({ searchStoryQuery: null }),
  setUnreadCount: (n) => set({ unreadCount: n }),
}));
