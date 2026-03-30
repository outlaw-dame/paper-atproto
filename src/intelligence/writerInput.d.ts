import type { ThreadStateForWriter, ConfidenceState } from './llmContracts.js';
import type { InterpolatorState, ContributionScores } from './interpolatorTypes.js';
import type { ThreadNode } from '../lib/resolver/atproto.js';
export type WriterTranslationMap = Record<string, {
    translatedText?: string;
    sourceLang?: string;
}>;
export declare function buildThreadStateForWriter(threadId: string, rootText: string, state: InterpolatorState, scores: Record<string, ContributionScores>, replies: ThreadNode[], confidence: ConfidenceState, translationById?: WriterTranslationMap, 
/** The actual handle of the root post author — used to correctly mark OP in contributor lists. */
rootAuthorHandle?: string): ThreadStateForWriter;
export { buildThreadStateForWriter as default };
//# sourceMappingURL=writerInput.d.ts.map