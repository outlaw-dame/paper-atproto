// ─── Glympse Intelligence — Verification Submodule ────────────────────────
// Phase 2: provider abstraction and evidence aggregation layer.
//
// Modules:
//   types                     — all verification type contracts
//   errors                    — VerificationError hierarchy
//   retry                     — verification-specific retry with backoff/jitter
//   cache                     — VerificationCache interface + InMemoryVerificationCache
//   utils                     — sanitization, scoring helpers, claim type inference
//   noopProviders             — safe heuristic/no-op default implementations
//   httpProviders             — Http*Provider classes for backend edge endpoints
//   verifyEvidence            — composite orchestration function
//   mergeVerificationIntoScore — enriches ContributionScore with VerificationOutcome

export * from './types';
export * from './errors';
// retry.js exports withRetry/RetryOptions which conflict with the top-level
// intelligence/retry.js re-export — keep it internal to the verification module.
export * from './cache';
export * from './utils';
export * from './noopProviders';
export * from './httpProviders';
export * from './verifyEvidence';
export * from './mergeVerificationIntoScore';
export * from './providerFactory';
