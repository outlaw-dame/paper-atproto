import type { BskyAgent } from '@atproto/api';
export interface MentionCandidate {
    type: 'mention';
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
}
export interface HashtagCandidate {
    type: 'hashtag';
    tag: string;
    isTrending: boolean;
}
export type AutocompleteCandidate = MentionCandidate | HashtagCandidate;
export interface UseComposerAutocompleteOptions {
    agent: BskyAgent;
    /** Trending topic slugs (no # prefix) loaded from the Bluesky API. */
    trendingTopics: string[];
    /** Recently-used hashtags from localStorage. */
    recentHashtags: string[];
    /** Favorited hashtags from localStorage. */
    favoriteHashtags: string[];
    /**
     * Called when a candidate is accepted. Provides the fully-replaced text
     * and the new cursor position so the parent can update its state.
     */
    onInsertCompletion: (newText: string, newCursor: number) => void;
}
export interface UseComposerAutocompleteReturn {
    /** Whether the dropdown is open (there are candidates or a fetch is in flight). */
    isOpen: boolean;
    candidates: AutocompleteCandidate[];
    selectedIndex: number;
    setSelectedIndex: (idx: number) => void;
    isLoading: boolean;
    triggerType: 'mention' | 'hashtag' | null;
    /** Call from the textarea's onChange handler. */
    notifyTextChange: (text: string, cursor: number) => void;
    /** Call from the textarea's onKeyDown handler. Returns true when the key
     *  was consumed (caller should call e.preventDefault()). */
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, currentText: string, currentCursor: number) => boolean;
    /** Dismiss without selecting. */
    dismiss: () => void;
    /** Select a candidate by index or reference (used by pointer interactions). */
    select: (candidate: AutocompleteCandidate, currentText: string, currentCursor: number) => void;
}
export declare function useComposerAutocomplete({ agent, trendingTopics, recentHashtags, favoriteHashtags, onInsertCompletion, }: UseComposerAutocompleteOptions): UseComposerAutocompleteReturn;
//# sourceMappingURL=useComposerAutocomplete.d.ts.map