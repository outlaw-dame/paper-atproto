import { create } from 'zustand';
function createEmptySession(id, rootUri) {
    return {
        id,
        graph: {
            rootUri: rootUri ?? id,
            nodesByUri: {},
            childUrisByParent: {},
            parentUriByChild: {},
            subtreeEndHints: {},
        },
        structure: {
            focusedAnchorUri: rootUri ?? id,
            visibleUris: [],
            deferredUris: [],
            hiddenUris: [],
            unresolvedChildCountsByUri: {},
        },
        interpretation: {
            interpolator: null,
            scoresByUri: {},
            writerResult: null,
            confidence: null,
            summaryMode: null,
            threadState: null,
        },
        evidence: {
            verificationByUri: {},
            rootVerification: null,
        },
        entities: {
            writerEntities: [],
            canonicalEntities: [],
            entityLandscape: [],
        },
        contributors: {
            contributors: [],
            topContributorDids: [],
        },
        translations: {
            byUri: {},
        },
        trajectory: {
            direction: 'forming',
            heatLevel: 0,
            repetitionLevel: 0,
            activityVelocity: 0,
            turningPoints: [],
        },
        meta: {
            status: 'idle',
            error: null,
        },
    };
}
export const useConversationSessionStore = create((set, get) => ({
    byId: {},
    ensureSession: (id, seedRootUri) => {
        set((state) => {
            if (state.byId[id])
                return state;
            return {
                byId: {
                    ...state.byId,
                    [id]: createEmptySession(id, seedRootUri),
                },
            };
        });
    },
    updateSession: (id, updater) => {
        set((state) => {
            const current = state.byId[id] ?? createEmptySession(id);
            return {
                byId: {
                    ...state.byId,
                    [id]: updater(current),
                },
            };
        });
    },
    getSession: (id) => get().byId[id] ?? null,
}));
//# sourceMappingURL=sessionStore.js.map