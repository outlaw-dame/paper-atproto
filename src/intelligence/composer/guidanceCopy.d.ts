import type { ComposerContext, ComposerGuidanceScores, ComposerGuidanceUi, ComposerGuidanceUiState } from './types.js';
import type { ComposerMLSignals } from './classifierContracts.js';
import type { AbuseModelResult } from '../../lib/abuseModel.js';
import type { SentimentResult } from '../../lib/sentiment.js';
export declare function buildComposerGuidanceUi(context: ComposerContext, heuristics: SentimentResult, state: ComposerGuidanceUiState, abuseScore: AbuseModelResult | null, ml: ComposerMLSignals, scores: ComposerGuidanceScores): ComposerGuidanceUi;
//# sourceMappingURL=guidanceCopy.d.ts.map