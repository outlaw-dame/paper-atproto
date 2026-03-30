import { create } from 'zustand';
import type {
  ConversationSession,
  ConversationSessionId,
} from './sessionTypes';

type ConversationSessionStore = {
  byId: Record<ConversationSessionId, ConversationSession>;
  ensureSession: (id: ConversationSessionId, seedRootUri?: ConversationSessionId) => void;
  updateSession: (
    id: ConversationSessionId,
    updater: (current: ConversationSession) => ConversationSession
  ) => void;
  getSession: (id: ConversationSessionId) => ConversationSession | null;
};

function createEmptySession(
  id: ConversationSessionId,
  rootUri?: ConversationSessionId,
): ConversationSession {
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
      revealedWarnUris: [],
      unresolvedChildCountsByUri: {},
    },
    interpretation: {
      interpolator: null,
      scoresByUri: {},
      writerResult: null,
      confidence: null,
      summaryMode: null,
      threadState: null,
      interpretiveExplanation: null,
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

export const useConversationSessionStore = create<ConversationSessionStore>((set, get) => ({
  byId: {},
  ensureSession: (id, seedRootUri) => {
    set((state) => {
      if (state.byId[id]) return state;
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
