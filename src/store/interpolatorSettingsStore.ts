import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface InterpolatorSettingsState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useInterpolatorSettingsStore = create<InterpolatorSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: 'glympse.interpolator-settings.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ enabled: state.enabled }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[InterpolatorSettings] Rehydration error:', error);
        }
      },
    },
  ),
);
