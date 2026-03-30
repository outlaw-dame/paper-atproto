export type FilterContext = 'home' | 'explore' | 'profile' | 'thread';
export type FilterAction = 'warn' | 'hide';
export interface KeywordFilterRule {
    id: string;
    phrase: string;
    wholeWord: boolean;
    contexts: FilterContext[];
    action: FilterAction;
    enabled: boolean;
    expiresAt: string | null;
    semantic: boolean;
    semanticThreshold: number;
    createdAt: string;
}
export interface PostFilterMatch {
    ruleId: string;
    phrase: string;
    action: FilterAction;
    matchType: 'keyword' | 'semantic';
    score?: number;
}
//# sourceMappingURL=types.d.ts.map