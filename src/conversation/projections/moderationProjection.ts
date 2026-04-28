export type ModerationDecision = 'visible' | 'warn' | 'hide';

export interface ModerationDecisionInput {
  hasUserHide: boolean;
  hasUserWarn: boolean;
  hiddenBySession: boolean;
  warnedBySession: boolean;
  revealedWarn: boolean;
}

export interface ModerationDecisionResult {
  decision: ModerationDecision;
  canRevealWarn: boolean;
}

// Precedence contract:
// 1) User hide is absolute and cannot be overridden in UI.
// 2) Session hide is next and cannot be overridden in UI.
// 3) Warn is user-controllable (tap show) and can be revealed per post.
export function projectModerationDecision(input: ModerationDecisionInput): ModerationDecisionResult {
  if (input.hasUserHide || input.hiddenBySession) {
    return {
      decision: 'hide',
      canRevealWarn: false,
    };
  }

  const warned = input.hasUserWarn || input.warnedBySession;
  if (warned && !input.revealedWarn) {
    return {
      decision: 'warn',
      canRevealWarn: true,
    };
  }

  return {
    decision: 'visible',
    canRevealWarn: false,
  };
}