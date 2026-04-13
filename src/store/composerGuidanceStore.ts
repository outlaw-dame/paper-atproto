import { create } from 'zustand';
import type { ComposerGuidanceResult } from '../intelligence/composer/types';

interface ComposerGuidanceStore {
  byDraftId: Record<string, ComposerGuidanceResult>;
  contextFingerprintByDraftId: Record<string, string>;
  dismissedByDraftId: Record<string, number>;
  setGuidance: (draftId: string, result: ComposerGuidanceResult, contextFingerprint: string) => void;
  dismissGuidance: (draftId: string) => void;
  clearGuidance: (draftId: string) => void;
}

export const useComposerGuidanceStore = create<ComposerGuidanceStore>((set) => ({
  byDraftId: {},
  contextFingerprintByDraftId: {},
  dismissedByDraftId: {},

  setGuidance: (draftId, result, contextFingerprint) => set((state) => {
    let dismissedByDraftId = state.dismissedByDraftId;
    if (draftId in dismissedByDraftId) {
      dismissedByDraftId = { ...dismissedByDraftId };
      delete dismissedByDraftId[draftId];
    }
    return {
      byDraftId: {
        ...state.byDraftId,
        [draftId]: result,
      },
      contextFingerprintByDraftId: {
        ...state.contextFingerprintByDraftId,
        [draftId]: contextFingerprint,
      },
      dismissedByDraftId,
    };
  }),

  dismissGuidance: (draftId) => set((state) => ({
    dismissedByDraftId: {
      ...state.dismissedByDraftId,
      [draftId]: Date.now(),
    },
  })),

  clearGuidance: (draftId) => set((state) => {
    const byDraftId = { ...state.byDraftId };
    const contextFingerprintByDraftId = { ...state.contextFingerprintByDraftId };
    const dismissedByDraftId = { ...state.dismissedByDraftId };
    delete byDraftId[draftId];
    delete contextFingerprintByDraftId[draftId];
    delete dismissedByDraftId[draftId];
    return {
      byDraftId,
      contextFingerprintByDraftId,
      dismissedByDraftId,
    };
  }),
}));
