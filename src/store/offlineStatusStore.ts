// ─── Offline Status Store ─────────────────────────────────────────────────────
// Observable network state for UI components.
// Driven by offlineState.ts subscriptions — not updated directly by components.

import { create } from 'zustand';
import type { NetworkState, CacheProvenance } from '../pwa/types';

interface OfflineStatusState {
  network: NetworkState;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  /** UI hint for feed cards — set by feed/sync layer, not this store. */
  feedProvenance: CacheProvenance;

  setNetwork: (state: NetworkState, timestamps?: { onlineAt?: string | undefined; offlineAt?: string | undefined }) => void;
  setFeedProvenance: (p: CacheProvenance) => void;
}

export const useOfflineStatusStore = create<OfflineStatusState>((set) => ({
  network: 'online',
  lastOnlineAt: null,
  lastOfflineAt: null,
  feedProvenance: 'fresh',

  setNetwork: (state, ts?) =>
    set({
      network: state,
      ...(ts?.onlineAt ? { lastOnlineAt: ts.onlineAt } : {}),
      ...(ts?.offlineAt ? { lastOfflineAt: ts.offlineAt } : {}),
    }),

  setFeedProvenance: (p) => set({ feedProvenance: p }),
}));
