import { analyzeComposeTone, analyzeComposeToneImmediate, } from '../composeTonePipeline.js';
import { toAnalyzeOptions } from './contextBuilder.js';
import { buildComposerGuidanceUi } from './guidanceCopy.js';
import { createEmptyComposerGuidanceResult, computeComposerGuidanceScores, deriveComposerGuidanceState, normalizeToolsUsed, uiStateToLevel, } from './guidanceScoring.js';
function fromToneAnalysis(context, analysis) {
    const state = deriveComposerGuidanceState(analysis.result, analysis.ml, analysis.abuseScore);
    const scores = computeComposerGuidanceScores(analysis.result, analysis.ml, analysis.abuseScore);
    return {
        mode: context.mode,
        level: uiStateToLevel(state),
        heuristics: analysis.result,
        ml: analysis.ml,
        scores,
        toolsUsed: normalizeToolsUsed(analysis.toolsUsed),
        abuseScore: analysis.abuseScore,
        ui: buildComposerGuidanceUi(context, analysis.result, state, analysis.abuseScore, analysis.ml, scores),
    };
}
export function analyzeComposerGuidanceImmediate(context) {
    if (!context.draftText.trim() && context.mode !== 'reply') {
        return createEmptyComposerGuidanceResult(context.mode);
    }
    const analysis = analyzeComposeToneImmediate(context.draftText, toAnalyzeOptions(context));
    return fromToneAnalysis(context, analysis);
}
export async function analyzeComposerGuidance(context) {
    if (!context.draftText.trim() && context.mode !== 'reply') {
        return createEmptyComposerGuidanceResult(context.mode);
    }
    const analysis = await analyzeComposeTone(context.draftText, toAnalyzeOptions(context));
    return fromToneAnalysis(context, analysis);
}
//# sourceMappingURL=guidancePipeline.js.map