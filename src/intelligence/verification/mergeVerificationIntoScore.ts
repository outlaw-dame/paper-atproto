import type { ContributionScore } from '../interpolatorTypes.js';
import type { VerificationOutcome } from './types.js';

// ─── mergeVerificationIntoContributionScore ───────────────────────────────
// Enriches an existing ContributionScore with evidence fields derived from
// a completed VerificationOutcome. The factualContribution field gets a
// weighted boost based on factualContributionScore × factualConfidence,
// capped at 1. All other fields are replaced wholesale from the outcome.

export function mergeVerificationIntoContributionScore(
  score: ContributionScore,
  verification: VerificationOutcome,
): ContributionScore {
  const factualContributionBoost =
    0.20 * verification.factualContributionScore * verification.factualConfidence;

  return {
    ...score,
    factualContribution: Math.max(0, Math.min(1, score.factualContribution + factualContributionBoost)),
    knownFactCheckMatch: verification.factCheck?.matched ?? false,
    factCheckMatchConfidence: verification.factCheck?.hits?.[0]?.matchConfidence ?? 0,
    mediaContextConfidence: verification.mediaContextConfidence,
  };
}
