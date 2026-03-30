import type { ContributionScore, ContributorImpact } from './interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
import { type EntityCatalog } from './entityLinking.js';
export declare function scoreReply(reply: ThreadNode, rootText: string, allReplies: ThreadNode[], entityCatalog: EntityCatalog, allCitedUrls: Set<string>): ContributionScore;
export declare function scoreAllReplies(rootText: string, replies: ThreadNode[]): Record<string, ContributionScore>;
export declare function computeContributorImpacts(replies: ThreadNode[], scores: Record<string, ContributionScore>): ContributorImpact[];
//# sourceMappingURL=scoreThread.d.ts.map