import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AppearanceState {
  showFeaturedHashtags: boolean;
  useMlFeaturedHashtagRanking: boolean;
  showProvenanceChips: boolean;
  showAtprotoLabelChips: boolean;
  setShowFeaturedHashtags: (show: boolean) => void;
  setUseMlFeaturedHashtagRanking: (enabled: boolean) => void;
  setShowProvenanceChips: (enabled: boolean) => void;
  setShowAtprotoLabelChips: (enabled: boolean) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      showFeaturedHashtags: true,
      useMlFeaturedHashtagRanking: false,
      showProvenanceChips: true,
      showAtprotoLabelChips: true,
      setShowFeaturedHashtags: (show) => set({ showFeaturedHashtags: show }),
      setUseMlFeaturedHashtagRanking: (enabled) => set({ useMlFeaturedHashtagRanking: enabled }),
      setShowProvenanceChips: (enabled) => set({ showProvenanceChips: enabled }),
      setShowAtprotoLabelChips: (enabled) => set({ showAtprotoLabelChips: enabled }),
    }),
    {
      name: 'glympse.appearance.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        showFeaturedHashtags: state.showFeaturedHashtags,
        useMlFeaturedHashtagRanking: state.useMlFeaturedHashtagRanking,
        showProvenanceChips: state.showProvenanceChips,
        showAtprotoLabelChips: state.showAtprotoLabelChips,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[Appearance] Rehydration error:', error);
        }
      },
    },
  ),
);