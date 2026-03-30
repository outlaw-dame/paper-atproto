// ─── App Capability Store ─────────────────────────────────────────────────────
// Read-only after initial detection, except for SW update state.
// Populated once during bootstrap — do not re-detect on every render.

import { create } from 'zustand';
import type { PwaCapabilities, ServiceWorkerRegistrationState } from '../pwa/types.js';

interface AppCapabilityState {
  capabilities: PwaCapabilities | null;
  swState: ServiceWorkerRegistrationState | null;

  setCapabilities: (caps: PwaCapabilities) => void;
  setSwState: (state: ServiceWorkerRegistrationState) => void;
  setUpdateAvailable: () => void;
}

export const useAppCapabilityStore = create<AppCapabilityState>((set) => ({
  capabilities: null,
  swState: null,

  setCapabilities: (caps) => set({ capabilities: caps }),
  setSwState: (state) => set({ swState: state }),
  setUpdateAvailable: () =>
    set((s) =>
      s.swState
        ? { swState: { ...s.swState, updateAvailable: true } }
        : s
    ),
}));
