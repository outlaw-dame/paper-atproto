export interface UrlThreatMatch {
    threatType: string;
    platformType: string;
    threatEntryType: string;
    url: string;
    cacheDuration?: string;
}
export interface UrlSafetyVerdict {
    url: string;
    checked: boolean;
    status: 'safe' | 'unsafe' | 'unknown';
    safe: boolean;
    blocked: boolean;
    reason?: string;
    threats: UrlThreatMatch[];
}
export declare function checkUrlSafety(rawUrl: string): Promise<UrlSafetyVerdict>;
//# sourceMappingURL=urlSafety.d.ts.map