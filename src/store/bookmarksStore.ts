import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Maximum bookmarks stored per account. Oldest entries are pruned when exceeded. */
export const MAX_BOOKMARKS = 500;

interface BookmarksState {
  /** DID -> bookmarked post URIs */
  bookmarksByDid: Record<string, string[]>;

  /** Add a post URI to bookmarks for the active account */
  addBookmark: (did: string, uri: string) => void;

  /** Remove a post URI from bookmarks for the active account */
  removeBookmark: (did: string, uri: string) => void;

  /** Check if a post URI is bookmarked for the active account */
  isBookmarked: (did: string, uri: string) => boolean;

  /** Get bookmarked post URIs for an account */
  getBookmarkedUris: (did: string) => string[];

  /** Clear bookmarks for one account, or all when no did is provided */
  clearBookmarks: (did?: string) => void;
}

function getDidBookmarks(state: BookmarksState, did: string): string[] {
  if (!did) return [];
  return state.bookmarksByDid[did] ?? [];
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarksByDid: {},

      addBookmark: (did: string, uri: string) => {
        if (!did || !uri) return;
        set((state) => {
          const current = getDidBookmarks(state, did);
          if (current.includes(uri)) {
            return state;
          }
          // Append new entry; if over cap, drop the oldest entries.
          const updated = [...current, uri];
          const pruned = updated.length > MAX_BOOKMARKS
            ? updated.slice(updated.length - MAX_BOOKMARKS)
            : updated;
          return {
            bookmarksByDid: {
              ...state.bookmarksByDid,
              [did]: pruned,
            },
          };
        });
      },

      removeBookmark: (did: string, uri: string) => {
        if (!did || !uri) return;
        set((state) => {
          const current = getDidBookmarks(state, did);
          return {
            bookmarksByDid: {
              ...state.bookmarksByDid,
              [did]: current.filter((u) => u !== uri),
            },
          };
        });
      },

      isBookmarked: (did: string, uri: string) => {
        if (!did || !uri) return false;
        return getDidBookmarks(get(), did).includes(uri);
      },

      getBookmarkedUris: (did: string) => {
        if (!did) return [];
        return [...getDidBookmarks(get(), did)];
      },

      clearBookmarks: (did?: string) => {
        if (!did) {
          set({ bookmarksByDid: {} });
          return;
        }
        set((state) => ({
          bookmarksByDid: {
            ...state.bookmarksByDid,
            [did]: [],
          },
        }));
      },
    }),
    {
      name: 'bookmarks-store',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
