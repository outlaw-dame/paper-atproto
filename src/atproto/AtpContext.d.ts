import React from 'react';
import type { AppBskyActorDefs } from '@atproto/api';
import { useSessionStore, type SessionData } from '../store/sessionStore.js';
export interface AtpContextValue {
    session: SessionData | null;
    profile: AppBskyActorDefs.ProfileViewDetailed | null;
    isLoading: boolean;
    error: string | null;
    login: (identifier: string) => Promise<void>;
    logout: () => Promise<void>;
    /** Direct agent access for one-off calls that aren't worth a query hook */
    agent: ReturnType<typeof useSessionStore>['agent'];
    isHostedOAuthClientConfigured: boolean;
    oauthConfigWarning: string | null;
    oauthConfigBlockingError: string | null;
}
export declare function useAtp(): AtpContextValue;
export declare function AtpProvider({ children }: {
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=AtpContext.d.ts.map