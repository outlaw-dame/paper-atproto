import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
export interface OAuthRuntimeConfigStatus {
    canStartOAuth: boolean;
    blockingMessage: string | null;
    warningMessage: string | null;
}
export declare function isHostedOAuthClientConfigured(): boolean;
export declare function getOAuthRuntimeConfigStatus(currentHref?: string, configuredClientId?: string | null): OAuthRuntimeConfigStatus;
export declare function getOAuthClient(): Promise<BrowserOAuthClient>;
export declare function sanitizeAuthIdentifier(value: string): string;
export declare function isLikelyAuthIdentifier(value: string): boolean;
export declare function createOAuthState(): string;
export declare function getOAuthRequestedScope(): string;
//# sourceMappingURL=oauthClient.d.ts.map