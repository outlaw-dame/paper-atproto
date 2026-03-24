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

export * from './types.js';
export * from './errors.js';
export * from './retry.js';
export * from './cache.js';
export * from './utils.js';
export * from './noopProviders.js';
export * from './httpProviders.js';
export * from './verifyEvidence.js';
export * from './mergeVerificationIntoScore.js';
