// ─── App Capability Store ─────────────────────────────────────────────────────
// Read-only after initial detection, except for SW update state.
// Populated once during bootstrap — do not re-detect on every render.
import { create } from 'zustand';
export const useAppCapabilityStore = create((set) => ({
    capabilities: null,
    swState: null,
    setCapabilities: (caps) => set({ capabilities: caps }),
    setSwState: (state) => set({ swState: state }),
    setUpdateAvailable: () => set((s) => s.swState
        ? { swState: { ...s.swState, updateAvailable: true } }
        : s),
}));
//# sourceMappingURL=appCapabilityStore.js.map