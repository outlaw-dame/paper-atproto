import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AccountFeedSource } from '../lib/atproto/accountFeeds';

const STORE_KEY = 'account-feeds.v1';
const STALE_AFTER_MS = 1000 * 60 * 20;
const MAX_ACCOUNT_COUNT = 12;
const MAX_FEEDS_PER_ACCOUNT = 120;
const MAX_ACCOUNT_DID_LENGTH = 190;
const MAX_SELECTED_FEED_ID_LENGTH = 128;

interface AccountFeedsEntry {
  sources: AccountFeedSource[];
  updatedAt: number;
  stale: boolean;
}

interface AccountFeedsState {
  byDid: Record<string, AccountFeedsEntry>;
  selectedFeedIdByDid: Record<string, string | null>;

  hydrateForDid: (did: string, sources: AccountFeedSource[]) => void;
  markStale: (did: string) => void;
  clearDid: (did: string) => void;
  clearAll: () => void;
  getSources: (did: string | null | undefined) => AccountFeedSource[];
  isStale: (did: string | null | undefined) => boolean;
  getSelectedFeedId: (did: string | null | undefined) => string | null;
  setSelectedFeedId: (did: string, feedId: string | null) => void;
}

function sanitizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function sanitizeSource(source: AccountFeedSource): AccountFeedSource | null {
  const id = sanitizeBoundedString(source.id, MAX_SELECTED_FEED_ID_LENGTH);
  const value = sanitizeBoundedString(source.value, 1024);
  const title = sanitizeBoundedString(source.title, 160);
  if (!id || !value || !title) return null;
  if (source.kind !== 'feed' && source.kind !== 'list' && source.kind !== 'timeline') return null;

  const description = sanitizeBoundedString(source.description, 280);
  const avatar = sanitizeBoundedString(source.avatar, 1024);

  return {
    id,
    kind: source.kind,
    value,
    pinned: source.pinned === true,
    title,
    ...(description ? { description } : {}),
    ...(avatar ? { avatar } : {}),
  };
}

function pruneEntries(entries: Record<string, AccountFeedsEntry>): Record<string, AccountFeedsEntry> {
  const now = Date.now();
  const normalized = Object.entries(entries)
    .flatMap(([did, entry]) => {
      const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
      if (!normalizedDid || !entry || typeof entry !== 'object') return [];
      const updatedAt = Number(entry.updatedAt ?? NaN);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) return [];

      const sanitizedSources = Array.isArray(entry.sources)
        ? entry.sources
          .map((source) => sanitizeSource(source))
          .filter((source): source is AccountFeedSource => Boolean(source))
          .slice(0, MAX_FEEDS_PER_ACCOUNT)
        : [];

      return [[normalizedDid, {
        sources: sanitizedSources,
        updatedAt,
        stale: entry.stale === true || now - updatedAt > STALE_AFTER_MS,
      }] as const];
    })
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_ACCOUNT_COUNT);

  return Object.fromEntries(normalized);
}

function pruneSelected(
  selected: Record<string, string | null>,
  validDidSet: Set<string>,
): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  for (const [did, selectedFeedId] of Object.entries(selected)) {
    if (!validDidSet.has(did)) continue;
    const sanitized = sanitizeBoundedString(selectedFeedId, MAX_SELECTED_FEED_ID_LENGTH);
    next[did] = sanitized;
  }
  return next;
}

export const useAccountFeedsStore = create<AccountFeedsState>()(
  persist(
    (set, get) => ({
      byDid: {},
      selectedFeedIdByDid: {},

      hydrateForDid: (did, sources) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return;

        const sanitizedSources = sources
          .map((source) => sanitizeSource(source))
          .filter((source): source is AccountFeedSource => Boolean(source))
          .slice(0, MAX_FEEDS_PER_ACCOUNT);

        set((state) => {
          const updatedEntries = pruneEntries({
            ...state.byDid,
            [normalizedDid]: {
              sources: sanitizedSources,
              updatedAt: Date.now(),
              stale: false,
            },
          });

          const validDidSet = new Set(Object.keys(updatedEntries));
          const selected = pruneSelected(state.selectedFeedIdByDid, validDidSet);
          const existingSelected = selected[normalizedDid] ?? null;
          const selectedStillValid = existingSelected
            && sanitizedSources.some((source) => source.id === existingSelected);
          selected[normalizedDid] = selectedStillValid
            ? existingSelected
            : (sanitizedSources.find((source) => source.pinned)?.id ?? sanitizedSources[0]?.id ?? null);

          return {
            byDid: updatedEntries,
            selectedFeedIdByDid: selected,
          };
        });
      },

      markStale: (did) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return;
        set((state) => {
          const existing = state.byDid[normalizedDid];
          if (!existing) return state;
          return {
            byDid: {
              ...state.byDid,
              [normalizedDid]: {
                ...existing,
                stale: true,
              },
            },
          };
        });
      },

      clearDid: (did) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return;

        set((state) => {
          const nextEntries = { ...state.byDid };
          const nextSelected = { ...state.selectedFeedIdByDid };
          delete nextEntries[normalizedDid];
          delete nextSelected[normalizedDid];
          return {
            byDid: nextEntries,
            selectedFeedIdByDid: nextSelected,
          };
        });
      },

      clearAll: () => {
        set({ byDid: {}, selectedFeedIdByDid: {} });
      },

      getSources: (did) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return [];
        return get().byDid[normalizedDid]?.sources ?? [];
      },

      isStale: (did) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return false;
        const entry = get().byDid[normalizedDid];
        if (!entry) return false;
        return entry.stale || Date.now() - entry.updatedAt > STALE_AFTER_MS;
      },

      getSelectedFeedId: (did) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return null;
        return get().selectedFeedIdByDid[normalizedDid] ?? null;
      },

      setSelectedFeedId: (did, feedId) => {
        const normalizedDid = sanitizeBoundedString(did, MAX_ACCOUNT_DID_LENGTH);
        if (!normalizedDid) return;

        const normalizedFeedId = sanitizeBoundedString(feedId, MAX_SELECTED_FEED_ID_LENGTH);
        const sources = get().byDid[normalizedDid]?.sources ?? [];
        const isValid = normalizedFeedId
          ? sources.some((source) => source.id === normalizedFeedId)
          : true;
        if (!isValid) return;

        set((state) => ({
          selectedFeedIdByDid: {
            ...state.selectedFeedIdByDid,
            [normalizedDid]: normalizedFeedId,
          },
        }));
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const byDid = pruneEntries(state.byDid);
        const selectedFeedIdByDid = pruneSelected(state.selectedFeedIdByDid, new Set(Object.keys(byDid)));
        return { byDid, selectedFeedIdByDid };
      },
      migrate: (persistedState) => {
        const source = persistedState && typeof persistedState === 'object'
          ? persistedState as Partial<AccountFeedsState>
          : {};
        const byDid = pruneEntries(source.byDid && typeof source.byDid === 'object' ? source.byDid : {});
        const selectedFeedIdByDid = pruneSelected(
          source.selectedFeedIdByDid && typeof source.selectedFeedIdByDid === 'object' ? source.selectedFeedIdByDid : {},
          new Set(Object.keys(byDid)),
        );
        return { byDid, selectedFeedIdByDid };
      },
    },
  ),
);
