import { create } from 'zustand';
import type { PostFilterMatch } from '../lib/contentFilters/types';

type ResultByPostId = Record<string, PostFilterMatch[]>;

type ContentFilterMetricsState = {
  filteredCountByRuleId: Record<string, number>;
  seenRulePostKeys: Record<string, true>;
  recordMatches: (context: string, results: ResultByPostId) => void;
  resetCounts: () => void;
};

export const useContentFilterMetricsStore = create<ContentFilterMetricsState>((set) => ({
  filteredCountByRuleId: {},
  seenRulePostKeys: {},
  recordMatches: (context, results) => {
    set((state) => {
      const nextCounts = { ...state.filteredCountByRuleId };
      const nextSeen = { ...state.seenRulePostKeys };

      for (const [postId, matches] of Object.entries(results)) {
        for (const match of matches) {
          const dedupeKey = `${context}:${postId}:${match.ruleId}`;
          if (nextSeen[dedupeKey]) continue;
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
