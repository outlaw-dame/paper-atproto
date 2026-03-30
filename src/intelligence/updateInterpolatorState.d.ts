import type { InterpolatorState, InterpolatorTrigger, ContributionScore } from './interpolatorTypes.js';
export declare function detectTrigger(existingState: InterpolatorState | null, newScores: Record<string, ContributionScore>, newRepliesCount: number, userFeedbackReplyUri?: string): InterpolatorTrigger | null;
export declare function applyTriggerToState(existing: InterpolatorState, patch: Partial<Omit<InterpolatorState, 'rootUri' | 'version' | 'updatedAt'>>, trigger: InterpolatorTrigger): InterpolatorState;
//# sourceMappingURL=updateInterpolatorState.d.ts.map