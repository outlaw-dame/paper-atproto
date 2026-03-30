export interface OAuthCallbackError {
    code: string;
    description: string | null;
    message: string;
}
export declare function hasOAuthCallbackParams(search: string): boolean;
export declare function getOAuthCallbackError(search: string): OAuthCallbackError | null;
export declare function buildClearedOAuthCallbackUrl(href: string): string | null;
//# sourceMappingURL=oauthCallback.d.ts.map