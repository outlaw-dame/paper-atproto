import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type MediaSettingsState = {
  preferredCaptionLanguage: string | null;
  setPreferredCaptionLanguage: (lang: string | null) => void;
};

export const useMediaSettingsStore = create<MediaSettingsState>()(
  persist(
    (set) => ({
      preferredCaptionLanguage: null,
      setPreferredCaptionLanguage: (lang) => set({ preferredCaptionLanguage: lang }),
    }),
    {
      name: 'glympse.media.settings.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ preferredCaptionLanguage: state.preferredCaptionLanguage }),
    },
  ),
);
