// ─── Offline Status Store ─────────────────────────────────────────────────────
// Observable network state for UI components.
// Driven by offlineState.ts subscriptions — not updated directly by components.
import { create } from 'zustand';
export const useOfflineStatusStore = create((set) => ({
    network: 'online',
    lastOnlineAt: null,
    lastOfflineAt: null,
    feedProvenance: 'fresh',
    setNetwork: (state, ts) => set({
        network: state,
        ...(ts?.onlineAt ? { lastOnlineAt: ts.onlineAt } : {}),
        ...(ts?.offlineAt ? { lastOfflineAt: ts.offlineAt } : {}),
    }),
    setFeedProvenance: (p) => set({ feedProvenance: p }),
}));
//# sourceMappingURL=offlineStatusStore.js.map