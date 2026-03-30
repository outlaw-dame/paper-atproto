import type { MediaAnalysisRequest, WriterMediaFinding, MediaAnalysisResult } from './llmContracts.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
import type { ContributionScores } from './interpolatorTypes.js';
import { type MultimodalSignals } from './routing.js';
export declare function detectMediaSignals(root: ThreadNode, replies: ThreadNode[], scores: Record<string, ContributionScores>): MultimodalSignals;
export declare function selectMediaForAnalysis(threadId: string, root: ThreadNode, replies: ThreadNode[], scores: Record<string, ContributionScores>): MediaAnalysisRequest[];
export declare function mergeMediaResults(results: MediaAnalysisResult[]): WriterMediaFinding[];
export { computeMultimodalScore, shouldRunMultimodal } from './routing.js';
//# sourceMappingURL=mediaInput.d.ts.map