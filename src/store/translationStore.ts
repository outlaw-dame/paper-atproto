import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TranslationResult } from '../lib/i18n/types';
import {
  DEFAULT_TRANSLATION_POLICY,
  type TranslationPolicy,
} from '../lib/i18n/policy';

type TranslationStoreState = {
  policy: TranslationPolicy;
  byId: Record<string, TranslationResult>;
  setPolicy: (partial: Partial<TranslationPolicy>) => void;
  upsertTranslation: (result: TranslationResult) => void;
  clearTranslation: (id: string) => void;
};

export const useTranslationStore = create<TranslationStoreState>()(
  persist(
    (set) => ({
      policy: DEFAULT_TRANSLATION_POLICY,
      byId: {},
      setPolicy: (partial) =>
        set((state) => ({ policy: { ...state.policy, ...partial } })),
      upsertTranslation: (result) =>
        set((state) => ({
          byId: {
            ...state.byId,
            [result.id]: result,
          },
        })),
      clearTranslation: (id) =>
        set((state) => {
          const next = { ...state.byId };
          delete next[id];
          return { byId: next };
        }),
    }),
    {
      name: 'glympse.translation.policy.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ policy: state.policy }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('[Translation] Rehydration error:', error);
        }
      },
    },
  ),
);
