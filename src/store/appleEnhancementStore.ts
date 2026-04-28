// ─── Apple Enhancement Store ──────────────────────────────────────────────────
// Tracks Apple-only enhancement availability and opt-in state.
// Core app behavior must never depend on this store.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppleEnhancementAvailability } from '../apple/types';

type CloudKitSyncState = 'idle' | 'syncing' | 'error' | 'unavailable';

interface AppleEnhancementState {
  availability: AppleEnhancementAvailability | null;
  /** User opted in to Apple-only convenience sync. */
  cloudKitEnabled: boolean;
  cloudKitSyncState: CloudKitSyncState;
  cloudKitLastSyncAt: string | null;
  cloudKitErrorMessage: string | null;
  cloudKitRetryAttempt: number;

  setAvailability: (a: AppleEnhancementAvailability) => void;
  setCloudKitEnabled: (value: boolean) => void;
  setCloudKitSyncState: (state: CloudKitSyncState, errorMessage?: string) => void;
  setCloudKitRetryAttempt: (attempt: number) => void;
  recordCloudKitSync: () => void;
}

export const useAppleEnhancementStore = create<AppleEnhancementState>()(
  persist(
    (set) => ({
      availability: null,
      cloudKitEnabled: false,
      cloudKitSyncState: 'idle',
      cloudKitLastSyncAt: null,
      cloudKitErrorMessage: null,
      cloudKitRetryAttempt: 0,

      setAvailability: (a) => set({ availability: a }),
      setCloudKitEnabled: (value) =>
        set({ cloudKitEnabled: value, cloudKitSyncState: value ? 'idle' : 'unavailable', cloudKitRetryAttempt: 0 }),
      setCloudKitSyncState: (state, errorMessage) =>
        set({ cloudKitSyncState: state, cloudKitErrorMessage: errorMessage ?? null }),
      setCloudKitRetryAttempt: (attempt) =>
        set({ cloudKitRetryAttempt: Math.max(0, Math.floor(attempt)) }),
      recordCloudKitSync: () =>
        set({
          cloudKitLastSyncAt: new Date().toISOString(),
          cloudKitSyncState: 'idle',
          cloudKitErrorMessage: null,
          cloudKitRetryAttempt: 0,
        }),
    }),
    {
      name: 'glimpse-apple-enhancement-v1',
      version: 1,
      // Only persist user opt-in preference — availability is re-detected on each launch.
      partialize: (s) => ({ cloudKitEnabled: s.cloudKitEnabled }),
    }
  )
);
