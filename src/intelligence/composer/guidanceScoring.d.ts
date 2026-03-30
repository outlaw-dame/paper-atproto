import type { SentimentResult } from '../../lib/sentiment.js';
import type { AbuseModelResult } from '../../lib/abuseModel.js';
import type { ComposerMLSignals } from './classifierContracts.js';
import type { ComposerGuidanceLevel, ComposerGuidanceResult, ComposerGuidanceScores, ComposerGuidanceTool, ComposerGuidanceUiState, ComposerMode } from './types.js';
export declare function createEmptyComposerGuidanceScores(): ComposerGuidanceScores;
export declare function createEmptyComposerGuidanceResult(mode: ComposerMode): ComposerGuidanceResult;
export declare function hasVisibleComposerGuidance(result: ComposerGuidanceResult): boolean;
export declare function computeComposerGuidanceScores(heuristics: SentimentResult, ml: ComposerMLSignals, abuseScore: AbuseModelResult | null): ComposerGuidanceScores;
export declare function deriveComposerGuidanceState(heuristics: SentimentResult, ml: ComposerMLSignals, abuseScore: AbuseModelResult | null): ComposerGuidanceUiState;
export declare function uiStateToLevel(state: ComposerGuidanceUiState): ComposerGuidanceLevel;
export declare function normalizeToolsUsed(toolsUsed: string[]): ComposerGuidanceTool[];
//# sourceMappingURL=guidanceScoring.d.ts.map