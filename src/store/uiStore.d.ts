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
    exploreSearchQuery: string | null;
    unreadCount: number;
    profileDid: string | null;
    composeDraft: string;
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
    openExploreSearch: (query: string) => void;
    clearExploreSearch: () => void;
    setUnreadCount: (n: number) => void;
    openProfile: (did: string) => void;
}
export declare const useUiStore: import("zustand").UseBoundStore<import("zustand").StoreApi<UiState>>;
export {};
//# sourceMappingURL=uiStore.d.ts.map