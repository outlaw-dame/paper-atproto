// ─── Glympse Intelligence Layer ───────────────────────────────────────────
// Barrel export — import everything from here.
//
// Modules:
//   interpolatorTypes  — full type contract (ContributionScore, InterpolatorState, …)
//   retry              — thread-loading retry with thread-specific defaults
//   scoreThread        — entity-aware, evidence-aware reply scorer
//   buildInterpolatorSummary — richer summary builder
//   updateInterpolatorState  — meaningful trigger detection + state merge
//   atprotoInterpolatorAdapter — main pipeline entry point
//   verification/      — Phase 2: provider abstraction + evidence aggregation layer

export * from './interpolatorTypes';
export * from './retry';
export * from './scoreThread';
export * from './buildInterpolatorSummary';
export * from './updateInterpolatorState';
export * from './atprotoInterpolatorAdapter';
export * from './entityLinking';
export * from './threadPipeline';
export * from './verification/index';
