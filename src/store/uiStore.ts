// ─── UI Store ──────────────────────────────────────────────────────────────
// Owns all transient UI state: active tab, overlay visibility, story entry.
// Keeping this in Zustand (rather than useState in App) means any component
// can open a story or toggle compose without prop-drilling.

import { create } from 'zustand';
import type { TabId, StoryEntry } from '../App';

interface UiState {
  activeTab: TabId;
  prevTab: TabId;
  showCompose: boolean;
  story: StoryEntry | null;
  unreadCount: number;

  // Actions
  setTab: (id: TabId) => void;
  openCompose: () => void;
  closeCompose: () => void;
  openStory: (entry: StoryEntry) => void;
  closeStory: () => void;
  setUnreadCount: (n: number) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: 'home',
  prevTab: 'home',
  showCompose: false,
  story: null,
  unreadCount: 0,

  setTab: (id) => set({ prevTab: get().activeTab, activeTab: id }),
  openCompose: () => set({ showCompose: true }),
  closeCompose: () => set({ showCompose: false }),
  openStory: (entry) => set({ story: entry }),
  closeStory: () => set({ story: null }),
  setUnreadCount: (n) => set({ unreadCount: n }),
}));
