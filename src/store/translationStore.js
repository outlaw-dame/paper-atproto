import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_TRANSLATION_POLICY, } from '../lib/i18n/policy.js';
export const useTranslationStore = create()(persist((set) => ({
    policy: DEFAULT_TRANSLATION_POLICY,
    byId: {},
    setPolicy: (partial) => set((state) => ({ policy: { ...state.policy, ...partial } })),
    upsertTranslation: (result) => set((state) => ({
        byId: {
            ...state.byId,
            [result.id]: result,
        },
    })),
    clearTranslation: (id) => set((state) => {
        const next = { ...state.byId };
        delete next[id];
        return { byId: next };
    }),
}), {
    name: 'glympse.translation.policy.v1',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({ policy: state.policy }),
    onRehydrateStorage: () => (state, error) => {
        if (error) {
            console.warn('[Translation] Rehydration error:', error);
        }
    },
}));
//# sourceMappingURL=translationStore.js.map