import type { MockPost } from '../../data/mockData.js';
import type { FilterContext, KeywordFilterRule, PostFilterMatch } from './types.js';
export declare function searchableTextForPost(post: MockPost): string;
export declare function activeRulesForContext(rules: KeywordFilterRule[], context: FilterContext): KeywordFilterRule[];
export declare function getKeywordMatches(text: string, rules: KeywordFilterRule[]): PostFilterMatch[];
export declare function getSemanticMatches(text: string, rules: KeywordFilterRule[]): Promise<PostFilterMatch[]>;
//# sourceMappingURL=match.d.ts.map