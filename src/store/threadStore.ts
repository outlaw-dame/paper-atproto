// ─── Rolling Thread State Store (Pipeline B) ─────────────────────────────
// Now powered by the Glympse Intelligence layer (src/intelligence/).
//
// Scoring and summary-building have moved out of this file:
//   • Scoring  → src/intelligence/scoreThread.ts
//   • Summary  → src/intelligence/buildInterpolatorSummary.ts
//   • Pipeline → src/intelligence/atprotoInterpolatorAdapter.ts
//
// This store owns persistence and provides reactive Zustand access to
// InterpolatorState. StoryMode calls runInterpolatorPipeline() and then
// calls setInterpolatorState() to commit the result here.

import { create } from 'zustand';
import type { InterpolatorState, ContributionScore, ContributionRole } from '../intelligence/index.js';

// ─── Legacy type aliases (backward compatibility) ─────────────────────────
// Existing callers that imported ReplyScore or ThreadState from this module
// continue to work without changes.
export type { ContributionRole, ContributionScore, InterpolatorState };
/** @deprecated Use ContributionScore */
export type ReplyScore = ContributionScore;
/** @deprecated Use InterpolatorState */
export type ThreadState = InterpolatorState;

// ─── Store interface ──────────────────────────────────────────────────────
interface ThreadStoreState {
  threads: Record<string, InterpolatorState>;

  /** Initialize an empty state when a thread is first opened. */
  initThread: (rootUri: string) => void;

  /**
   * Replace the full InterpolatorState for a thread.
   * This is the primary write path — called after runInterpolatorPipeline().
   */
  setInterpolatorState: (rootUri: string, state: InterpolatorState) => void;

  /**
   * Patch the rolling summary fields only.
   * @deprecated Prefer setInterpolatorState via runInterpolatorPipeline.
   */
  updateSummary: (
    rootUri: string,
    patch: Partial<Omit<InterpolatorState, 'rootUri' | 'version'>>
  ) => void;

  /**
   * Record a single reply score.
   * @deprecated Prefer setInterpolatorState via runInterpolatorPipeline.
   */
  setReplyScore: (rootUri: string, score: ContributionScore) => void;

  /** Record user feedback on a reply — always meaningful, updates version. */
  setUserFeedback: (
    rootUri: string,
    replyUri: string,
    feedback: ContributionScore['userFeedback']
  ) => void;

  /** Get the current state for a thread, or null if not yet initialised. */
  getThread: (rootUri: string) => InterpolatorState | null;
}

// ─── Empty state factory ──────────────────────────────────────────────────
function emptyState(rootUri: string): InterpolatorState {
  return {
    rootUri,
    summaryText: '',
    salientClaims: [],
    salientContributors: [],
    clarificationsAdded: [],
    newAnglesAdded: [],
    repetitionLevel: 0,
    heatLevel: 0,
    sourceSupportPresent: false,
    replyScores: {},
    entityLandscape: [],
    topContributors: [],
    evidencePresent: false,
    factualSignalPresent: false,
    lastTrigger: null,
    triggerHistory: [],
    updatedAt: new Date().toISOString(),
    version: 0,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────
export const useThreadStore = create<ThreadStoreState>((set, get) => ({
  threads: {},

  initThread: (rootUri) => {
    set(state => {
      if (state.threads[rootUri]) return state;
      return { threads: { ...state.threads, [rootUri]: emptyState(rootUri) } };
    });
  },

  setInterpolatorState: (rootUri, newState) => {
    set(s => ({ threads: { ...s.threads, [rootUri]: newState } }));
  },

  updateSummary: (rootUri, patch) => {
    set(state => {
      const existing = state.threads[rootUri] ?? emptyState(rootUri);
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            ...patch,
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          },
        },
      };
    });
  },

  setReplyScore: (rootUri, score) => {
    set(state => {
      const existing = state.threads[rootUri] ?? emptyState(rootUri);
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            replyScores: { ...existing.replyScores, [score.uri]: score },
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          },
        },
      };
    });
  },

  setUserFeedback: (rootUri, replyUri, feedback) => {
    set(state => {
      const existing = state.threads[rootUri];
      if (!existing) return state;
      const existingScore = existing.replyScores[replyUri];
      if (!existingScore) return state;
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            replyScores: {
              ...existing.replyScores,
              [replyUri]: { ...existingScore, userFeedback: feedback } as ContributionScore,
            },
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          } as InterpolatorState,
        },
      };
    });
  },

  getThread: (rootUri) => get().threads[rootUri] ?? null,
}));
