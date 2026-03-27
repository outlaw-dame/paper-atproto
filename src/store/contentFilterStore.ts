import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FilterContext, KeywordFilterRule, FilterAction } from '../lib/contentFilters/types.js';

type NewFilterRule = {
  phrase: string;
  wholeWord?: boolean;
  contexts?: FilterContext[];
  action?: FilterAction;
  enabled?: boolean;
  expiresAt?: string | null;
  semantic?: boolean;
  semanticThreshold?: number;
};

interface ContentFilterState {
  rules: KeywordFilterRule[];
  addRule: (rule: NewFilterRule) => void;
  removeRule: (id: string) => void;
  updateRule: (id: string, patch: Partial<KeywordFilterRule>) => void;
  toggleRule: (id: string, enabled: boolean) => void;
}

const DEFAULT_CONTEXTS: FilterContext[] = ['home'];

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `rule_${Math.random().toString(36).slice(2, 10)}`;
}

export const useContentFilterStore = create<ContentFilterState>()(
  persist(
    (set) => ({
      rules: [],
      addRule: (rule) => {
        const phrase = (rule.phrase ?? '').trim();
        if (!phrase) return;
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
    }),
    {
      name: 'glympse.content-filters.v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate: (_state: unknown, version: number) => {
        // v0 → v1: no migration needed yet
        return _state as ContentFilterState || { rules: [] };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('[ContentFilter] Rehydration error, starting fresh:', error);
        }
      },
    },
  ),
);
