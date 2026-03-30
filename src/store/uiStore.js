// ─── UI Store ──────────────────────────────────────────────────────────────
// Owns all transient UI state: active tab, overlay visibility, story entry,
// search story query, and prompt composer.
import { create } from 'zustand';
export const useUiStore = create((set, get) => ({
    activeTab: 'home',
    prevTab: 'home',
    showCompose: false,
    showPromptComposer: false,
    replyTarget: null,
    story: null,
    searchStoryQuery: null,
    exploreSearchQuery: null,
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
    openExploreSearch: (query) => set((s) => ({
        exploreSearchQuery: query,
        searchStoryQuery: null,
        story: null,
        prevTab: s.activeTab,
        activeTab: 'explore',
    })),
    clearExploreSearch: () => set({ exploreSearchQuery: null }),
    setUnreadCount: (n) => set({ unreadCount: n }),
    openProfile: (did) => set(s => ({ profileDid: did, prevTab: s.activeTab, activeTab: 'profile' })),
}));
//# sourceMappingURL=uiStore.js.map