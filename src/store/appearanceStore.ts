import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AppearanceState {
  showFeaturedHashtags: boolean;
  useMlFeaturedHashtagRanking: boolean;
  setShowFeaturedHashtags: (show: boolean) => void;
  setUseMlFeaturedHashtagRanking: (enabled: boolean) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      showFeaturedHashtags: true,
      useMlFeaturedHashtagRanking: false,
      setShowFeaturedHashtags: (show) => set({ showFeaturedHashtags: show }),
      setUseMlFeaturedHashtagRanking: (enabled) => set({ useMlFeaturedHashtagRanking: enabled }),
    }),
    {
      name: 'glympse.appearance.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        showFeaturedHashtags: state.showFeaturedHashtags,
        useMlFeaturedHashtagRanking: state.useMlFeaturedHashtagRanking,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[Appearance] Rehydration error:', error);
        }
      },
    },
  ),
);