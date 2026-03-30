// ─── Apple Enhancement Store ──────────────────────────────────────────────────
// Tracks Apple-only enhancement availability and opt-in state.
// Core app behavior must never depend on this store.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useAppleEnhancementStore = create()(persist((set) => ({
    availability: null,
    cloudKitEnabled: false,
    cloudKitSyncState: 'idle',
    cloudKitLastSyncAt: null,
    cloudKitErrorMessage: null,
    setAvailability: (a) => set({ availability: a }),
    setCloudKitEnabled: (value) => set({ cloudKitEnabled: value, cloudKitSyncState: value ? 'idle' : 'unavailable' }),
    setCloudKitSyncState: (state, errorMessage) => set({ cloudKitSyncState: state, cloudKitErrorMessage: errorMessage ?? null }),
    recordCloudKitSync: () => set({ cloudKitLastSyncAt: new Date().toISOString(), cloudKitSyncState: 'idle', cloudKitErrorMessage: null }),
}), {
    name: 'glimpse-apple-enhancement-v1',
    version: 1,
    // Only persist user opt-in preference — availability is re-detected on each launch.
    partialize: (s) => ({ cloudKitEnabled: s.cloudKitEnabled }),
}));
//# sourceMappingURL=appleEnhancementStore.js.map