import type { InterpolatorState, ContributionScore } from './interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
type SummaryPatch = Omit<InterpolatorState, 'rootUri' | 'version' | 'updatedAt' | 'replyScores' | 'lastTrigger' | 'triggerHistory'>;
export declare function buildInterpolatorSummary(rootText: string, replies: ThreadNode[], scores: Record<string, ContributionScore>): SummaryPatch;
export {};
//# sourceMappingURL=buildInterpolatorSummary.d.ts.map