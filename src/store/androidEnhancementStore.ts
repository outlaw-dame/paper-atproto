// ─── Android Enhancement Store ────────────────────────────────────────────────
// Tracks Android-specific capability state.
// Core app behavior must never depend on this store.

import { create } from 'zustand';
import type { AndroidEnhancementAvailability } from '../android/types';

interface AndroidEnhancementState {
  /** Detected capabilities — null until AndroidEnhancementBridge runs. */
  availability: AndroidEnhancementAvailability | null;
  setAvailability: (availability: AndroidEnhancementAvailability) => void;
}

export const useAndroidEnhancementStore = create<AndroidEnhancementState>((set) => ({
  availability: null,
  // Intentionally not persisted: capabilities are re-detected on every launch.
  setAvailability: (availability) => set({ availability }),
}));
