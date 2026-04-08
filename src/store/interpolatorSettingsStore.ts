import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PremiumAiProviderPreference = 'auto' | 'gemini' | 'openai';

interface InterpolatorSettingsState {
  enabled: boolean;
  premiumProviderPreference: PremiumAiProviderPreference;
  setEnabled: (enabled: boolean) => void;
  setPremiumProviderPreference: (premiumProviderPreference: PremiumAiProviderPreference) => void;
}

export const useInterpolatorSettingsStore = create<InterpolatorSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      premiumProviderPreference: 'auto',
      setEnabled: (enabled) => set({ enabled }),
      setPremiumProviderPreference: (premiumProviderPreference) => set({ premiumProviderPreference }),
    }),
    {
      name: 'glympse.interpolator-settings.v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        premiumProviderPreference: state.premiumProviderPreference,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[InterpolatorSettings] Rehydration error:', error);
        }
      },
    },
  ),
);
