import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PremiumAiProviderPreference = 'auto' | 'gemini' | 'openai';

interface InterpolatorSettingsState {
  enabled: boolean;
  showPrimaryReasons: boolean;
  showInterpretiveInspector: boolean;
  premiumProviderPreference: PremiumAiProviderPreference;
  setEnabled: (enabled: boolean) => void;
  setShowPrimaryReasons: (showPrimaryReasons: boolean) => void;
  setShowInterpretiveInspector: (showInterpretiveInspector: boolean) => void;
  setPremiumProviderPreference: (premiumProviderPreference: PremiumAiProviderPreference) => void;
}

export const useInterpolatorSettingsStore = create<InterpolatorSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      showPrimaryReasons: true,
      showInterpretiveInspector: false,
      premiumProviderPreference: 'auto',
      setEnabled: (enabled) => set({ enabled }),
      setShowPrimaryReasons: (showPrimaryReasons) => set({ showPrimaryReasons }),
      setShowInterpretiveInspector: (showInterpretiveInspector) => set({ showInterpretiveInspector }),
      setPremiumProviderPreference: (premiumProviderPreference) => set({ premiumProviderPreference }),
    }),
    {
      name: 'glympse.interpolator-settings.v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        showPrimaryReasons: state.showPrimaryReasons,
        showInterpretiveInspector: state.showInterpretiveInspector,
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
