import { Agent } from '@atproto/api';
import type { AppBskyActorDefs } from '@atproto/api';
export interface SessionData {
    did: string;
    handle: string;
    email?: string;
    scope?: string;
    issuer?: string;
}
interface SessionState {
    agent: Agent;
    session: SessionData | null;
    /** True once the agent has had resumeSession/login complete — safe to make authed API calls */
    sessionReady: boolean;
    profile: AppBskyActorDefs.ProfileViewDetailed | null;
    isLoading: boolean;
    error: string | null;
    setSession: (s: SessionData | null) => void;
    setSessionReady: (v: boolean) => void;
    setAgent: (a: Agent) => void;
    setProfile: (p: AppBskyActorDefs.ProfileViewDetailed | null) => void;
    setLoading: (v: boolean) => void;
    setError: (msg: string | null) => void;
    resetAgent: () => void;
}
export interface RecentHandle {
    handle: string;
    displayName?: string;
    avatar?: string;
}
export declare function getRecentHandles(): RecentHandle[];
export declare function saveRecentHandle(account: RecentHandle): void;
export declare function clearRecentHandles(): void;
export declare const useSessionStore: import("zustand").UseBoundStore<import("zustand").StoreApi<SessionState>>;
export {};
//# sourceMappingURL=sessionStore.d.ts.map
