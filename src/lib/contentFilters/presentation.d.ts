import type { PostFilterMatch } from './types.js';
export type WarnMatchReason = {
    phrase: string;
    reason: 'exact' | 'semantic' | 'exact+semantic';
};
export declare function warnMatchLabels(matches: PostFilterMatch[]): string[];
export declare function warnMatchReasons(matches: PostFilterMatch[]): WarnMatchReason[];
//# sourceMappingURL=presentation.d.ts.map