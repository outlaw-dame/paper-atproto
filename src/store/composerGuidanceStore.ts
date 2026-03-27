import { create } from 'zustand';
import type { ComposerGuidanceResult } from '../intelligence/composer/types.js';

interface ComposerGuidanceStore {
  byDraftId: Record<string, ComposerGuidanceResult>;
  dismissedByDraftId: Record<string, number>;
  setGuidance: (draftId: string, result: ComposerGuidanceResult) => void;
  dismissGuidance: (draftId: string) => void;
  clearGuidance: (draftId: string) => void;
}

export const useComposerGuidanceStore = create<ComposerGuidanceStore>((set) => ({
  byDraftId: {},
  dismissedByDraftId: {},

  setGuidance: (draftId, result) => set((state) => ({
    byDraftId: {
      ...state.byDraftId,
      [draftId]: result,
    },
  })),

  dismissGuidance: (draftId) => set((state) => ({
    dismissedByDraftId: {
      ...state.dismissedByDraftId,
      [draftId]: Date.now(),
    },
  })),

  clearGuidance: (draftId) => set((state) => {
    const byDraftId = { ...state.byDraftId };
    const dismissedByDraftId = { ...state.dismissedByDraftId };
    delete byDraftId[draftId];
    delete dismissedByDraftId[draftId];
    return {
      byDraftId,
      dismissedByDraftId,
    };
  }),
}));
