// ─── Interpolator Pipeline — Type Contracts ───────────────────────────────
// Full type contract for the entity-aware, contributor-aware, and
// evidence-aware Interpolator pipeline.
//
// Design constraints:
//   • Hard moderation signals (abuseScore) are kept SEPARATE from ranking
//   • factualContribution is a POSITIVE signal derived from local evidence
//   • knownFactCheckMatch / factCheckMatchConfidence / mediaContextConfidence
//     are present in the contract but Phase 1 populates them from local
//     thread evidence only — not from a live external verifier service
export {};
//# sourceMappingURL=interpolatorTypes.js.map