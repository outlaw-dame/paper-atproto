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
//   algorithms/        — deterministic decision algorithms (contributor selection, change detection, entity centrality, stance clustering)
//   verification/      — Phase 2: provider abstraction + evidence aggregation layer

export * from './interpolatorTypes';
export * from './retry';
export * from './scoreThread';
export * from './buildInterpolatorSummary';
export * from './updateInterpolatorState';
export * from './atprotoInterpolatorAdapter';
export * from './entityLinking';
export * from './threadPipeline';
export * from './contributorSelection';
export {
	computeThreadChange,
	type ThreadChangeResult,
	type ChangeReason as ThreadPipelineChangeReason,
} from './changeDetection';
export * from './redundancy';
export * from './algorithms';
export * from './verification/index';

// ─── Phase 0 quality layer ────────────────────────────────────────────────
// Import Phase 0 submodules via their own index paths — do not re-export at
// this barrel level to avoid name collisions with the verification submodule
// (e.g. SourceType, clamp01). Consumers import directly:
//   import { … } from '../intelligence/context';
//   import { … } from '../intelligence/heuristics';
//   import { … } from '../intelligence/fusion';
//   import { … } from '../intelligence/multimodal';
