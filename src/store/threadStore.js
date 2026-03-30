import { create } from 'zustand';
function emptyThreadSlice() {
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
export const useThreadStore = create((set, get) => ({
    byThread: {},
    ensureThread: (threadId) => {
        set((state) => {
            if (state.byThread[threadId])
                return state;
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
            if (!score)
                return state;
            return {
                byThread: {
                    ...state.byThread,
                    [threadId]: {
                        ...current,
                        scores: {
                            ...current.scores,
                            [replyUri]: {
                                ...score,
                                ...(feedback !== undefined ? { userFeedback: feedback } : {}),
                            },
                        },
                    },
                },
            };
        });
    },
    getThread: (threadId) => get().byThread[threadId] ?? null,
}));
//# sourceMappingURL=threadStore.js.map