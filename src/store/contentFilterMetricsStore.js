import { create } from 'zustand';
export const useContentFilterMetricsStore = create((set) => ({
    filteredCountByRuleId: {},
    seenRulePostKeys: {},
    recordMatches: (context, results) => {
        set((state) => {
            const nextCounts = { ...state.filteredCountByRuleId };
            const nextSeen = { ...state.seenRulePostKeys };
            for (const [postId, matches] of Object.entries(results)) {
                for (const match of matches) {
                    const dedupeKey = `${context}:${postId}:${match.ruleId}`;
                    if (nextSeen[dedupeKey])
                        continue;
                    nextSeen[dedupeKey] = true;
                    nextCounts[match.ruleId] = (nextCounts[match.ruleId] ?? 0) + 1;
                }
            }
            return {
                filteredCountByRuleId: nextCounts,
                seenRulePostKeys: nextSeen,
            };
        });
    },
    resetCounts: () => set({ filteredCountByRuleId: {}, seenRulePostKeys: {} }),
}));
//# sourceMappingURL=contentFilterMetricsStore.js.map