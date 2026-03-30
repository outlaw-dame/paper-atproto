import type { MockPost } from '../../data/mockData.js';
import type { FilterContext, PostFilterMatch } from './types.js';
type ResultByPostId = Record<string, PostFilterMatch[]>;
export declare function usePostFilterResults(posts: MockPost[], context: FilterContext): ResultByPostId;
export {};
//# sourceMappingURL=usePostFilterResults.d.ts.map