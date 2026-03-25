import { create } from 'zustand';
import type { TranslationResult } from '../lib/i18n/types.js';
import {
  DEFAULT_TRANSLATION_POLICY,
  type TranslationPolicy,
} from '../lib/i18n/policy.js';

type TranslationStoreState = {
  policy: TranslationPolicy;
  byId: Record<string, TranslationResult>;
  setPolicy: (partial: Partial<TranslationPolicy>) => void;
  upsertTranslation: (result: TranslationResult) => void;
  clearTranslation: (id: string) => void;
};

export const useTranslationStore = create<TranslationStoreState>((set) => ({
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
}));
