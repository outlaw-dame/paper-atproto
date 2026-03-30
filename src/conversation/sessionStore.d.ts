import type { ConversationSession, ConversationSessionId } from './sessionTypes.js';
type ConversationSessionStore = {
    byId: Record<ConversationSessionId, ConversationSession>;
    ensureSession: (id: ConversationSessionId, seedRootUri?: ConversationSessionId) => void;
    updateSession: (id: ConversationSessionId, updater: (current: ConversationSession) => ConversationSession) => void;
    getSession: (id: ConversationSessionId) => ConversationSession | null;
};
export declare const useConversationSessionStore: import("zustand").UseBoundStore<import("zustand").StoreApi<ConversationSessionStore>>;
export {};
//# sourceMappingURL=sessionStore.d.ts.map