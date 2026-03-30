import { create } from 'zustand';
export const useComposerGuidanceStore = create((set) => ({
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
//# sourceMappingURL=composerGuidanceStore.js.map