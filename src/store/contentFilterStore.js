import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
const DEFAULT_CONTEXTS = ['home'];
function nowIso() {
    return new Date().toISOString();
}
function makeId() {
    return `rule_${Math.random().toString(36).slice(2, 10)}`;
}
export const useContentFilterStore = create()(persist((set) => ({
    rules: [],
    addRule: (rule) => {
        const phrase = (rule.phrase ?? '').trim();
        if (!phrase)
            return;
        set((state) => ({
            rules: [
                {
                    id: makeId(),
                    phrase,
                    wholeWord: rule.wholeWord ?? false,
                    contexts: rule.contexts?.length ? rule.contexts : DEFAULT_CONTEXTS,
                    action: rule.action ?? 'warn',
                    enabled: rule.enabled ?? true,
                    expiresAt: rule.expiresAt ?? null,
                    semantic: rule.semantic ?? true,
                    semanticThreshold: rule.semanticThreshold ?? 0.72,
                    createdAt: nowIso(),
                },
                ...state.rules,
            ],
        }));
    },
    removeRule: (id) => set((state) => ({ rules: state.rules.filter((rule) => rule.id !== id) })),
    updateRule: (id, patch) => set((state) => ({
        rules: state.rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
    })),
    toggleRule: (id, enabled) => set((state) => ({
        rules: state.rules.map((rule) => rule.id === id ? { ...rule, enabled } : rule),
    })),
}), {
    name: 'glympse.content-filters.v1',
    storage: createJSONStorage(() => localStorage),
    version: 1,
    migrate: (_state, version) => {
        // v0 → v1: no migration needed yet
        return _state || { rules: [] };
    },
    onRehydrateStorage: () => (state, error) => {
        if (error) {
            console.warn('[ContentFilter] Rehydration error, starting fresh:', error);
        }
    },
}));
//# sourceMappingURL=contentFilterStore.js.map