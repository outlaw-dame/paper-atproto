import { create } from 'zustand';
import {
  applyContributionFeedbackSelection,
  type AtUri,
  type ContributionScores,
  type ThreadInterpolatorState,
} from '../intelligence/interpolatorTypes';
import type { VerificationOutcome } from '../intelligence/verification';
import type { ConfidenceState, SummaryMode, InterpolatorWriteResult } from '../intelligence/llmContracts';

type ThreadSlice = {
  interpolator: ThreadInterpolatorState | null;
  scores: Record<AtUri, ContributionScores>;
  verificationByPost: Record<AtUri, VerificationOutcome>;
  rootVerification: VerificationOutcome | null;
  /** Three-axis confidence computed after Phase 1/3 pipeline. */
  confidence: ConfidenceState | null;
  /** Summary mode chosen from confidence — normal / descriptive_fallback / minimal_fallback. */
  summaryMode: SummaryMode | null;
  /** Final writer result from Qwen3-4B. null until writer has responded. */
  writerResult: InterpolatorWriteResult | null;
  lastComputedAt?: string | undefined;
  error?: string | null | undefined;
  isLoading: boolean;
};

type ThreadStore = {
  byThread: Record<string, ThreadSlice>;
  ensureThread: (threadId: string) => void;
  setLoading: (threadId: string, isLoading: boolean) => void;
  setError: (threadId: string, error: string | null) => void;
  upsertThreadResult: (
    threadId: string,
    payload: {
      interpolator: ThreadInterpolatorState;
      scores: Record<AtUri, ContributionScores>;
      verificationByPost?: Record<AtUri, VerificationOutcome>;
      rootVerification?: VerificationOutcome | null;
      confidence?: ConfidenceState;
      summaryMode?: SummaryMode;
    },
  ) => void;
  setWriterResult: (threadId: string, writerResult: InterpolatorWriteResult) => void;
  setUserFeedback: (
    threadId: string,
    replyUri: AtUri,
    feedback: ContributionScores['userFeedback'],
  ) => void;
  getThread: (threadId: string) => ThreadSlice | null;
};

function emptyThreadSlice(): ThreadSlice {
  return {
    interpolator: null,
    scores: {},
    verificationByPost: {},
    rootVerification: null,
    confidence: null,
    summaryMode: null,
    writerResult: null,
    error: null,
    isLoading: false,
  };
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  byThread: {},

  ensureThread: (threadId) => {
    set((state) => {
      if (state.byThread[threadId]) return state;
      return {
        byThread: {
          ...state.byThread,
          [threadId]: emptyThreadSlice(),
        },
      };
    });
  },

  setLoading: (threadId, isLoading) => {
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadId]: {
          ...(state.byThread[threadId] ?? emptyThreadSlice()),
          isLoading,
        },
      },
    }));
  },

  setError: (threadId, error) => {
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadId]: {
          ...(state.byThread[threadId] ?? emptyThreadSlice()),
          error,
          isLoading: false,
        },
      },
    }));
  },

  upsertThreadResult: (threadId, payload) => {
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadId]: {
          ...(state.byThread[threadId] ?? emptyThreadSlice()),
          interpolator: payload.interpolator,
          scores: payload.scores,
          verificationByPost: payload.verificationByPost ?? {},
          rootVerification: payload.rootVerification ?? null,
          ...(payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
          ...(payload.summaryMode !== undefined ? { summaryMode: payload.summaryMode } : {}),
          // Clear stale writerResult so InterpolatorCard falls back to the heuristic
          // summaryText until the fresh async writer call completes.
          writerResult: null,
          lastComputedAt: new Date().toISOString(),
          error: null,
          isLoading: false,
        },
      },
    }));
  },

  setWriterResult: (threadId, writerResult) => {
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadId]: {
          ...(state.byThread[threadId] ?? emptyThreadSlice()),
          writerResult,
        },
      },
    }));
  },

  setUserFeedback: (threadId, replyUri, feedback) => {
    set((state) => {
      const current = state.byThread[threadId] ?? emptyThreadSlice();
      const score = current.scores[replyUri];
      if (!score) return state;

      return {
        byThread: {
          ...state.byThread,
          [threadId]: {
            ...current,
            scores: {
              ...current.scores,
              [replyUri]: applyContributionFeedbackSelection(score, feedback),
            },
          },
        },
      };
    });
  },

  getThread: (threadId) => get().byThread[threadId] ?? null,
}));
