import type { VerificationProviders } from '../intelligence/verification/types.js';
import type { VerificationCache } from '../intelligence/verification/cache.js';
type ThreadAgent = {
    getPostThread: (input: {
        uri: string;
        depth: number;
    }) => Promise<unknown>;
};
export declare function hydrateConversationSession(params: {
    sessionId: string;
    rootUri: string;
    agent: ThreadAgent;
    translationPolicy: {
        userLanguage: string;
        localOnlyMode: boolean;
    };
    providers: VerificationProviders;
    cache: VerificationCache;
    signal?: AbortSignal;
}): Promise<void>;
export {};
//# sourceMappingURL=sessionAssembler.d.ts.map