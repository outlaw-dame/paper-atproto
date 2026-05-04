/**
 * Capability registry — single source of truth that reconciles
 * `IntelligenceTask × IntelligenceLane × ModelChoice × EdgeCapability`.
 *
 * Design constraints:
 *   • Pure data + small, total lookup helpers — no I/O, no side effects.
 *   • Read-only frozen tables; never mutated at runtime.
 *   • Does NOT re-implement the deterministic routing policy. The policy
 *     remains authoritative; this registry only enumerates which lanes /
 *     models / edge capabilities are *eligible* for each task and provides
 *     weights so coordinators can score / rank / abstain without scattering
 *     constants across modules.
 *   • All exported helpers are total (defined for every member of the input
 *     enum) so callers cannot trip undefined-access bugs.
 *
 * Migration note: existing modules (intelligenceRoutingPolicy, modelPolicy,
 * edgeProviderPlanner, interpolatorWriterRoutingPolicy) keep their decision
 * logic. The registry is additive — it lets new code (the coordinator
 * facade and behaviour evals) cross-check those decisions.
 */
import type {
  IntelligenceLane,
  IntelligenceTask,
} from '../intelligenceRoutingPolicy';
import type { ModelChoice, TaskKind } from '../../runtime/modelPolicy';
import type { EdgeCapability } from '../edge/edgeProviderContracts';

export type GroundingRequirement = 'required' | 'preferred' | 'not_required';

export interface CapabilityWeights {
  /** Lower is cheaper. Relative scale 0–1. */
  cost: number;
  /** Lower is faster. Relative scale 0–1. */
  latency: number;
  /** Higher means more privacy-preserving. Relative scale 0–1. */
  privacy: number;
  /** Higher means more grounded / faithful output. Relative scale 0–1. */
  quality: number;
}

export interface IntelligenceTaskCapability {
  task: IntelligenceTask;
  /** Lanes that are eligible for this task (the deterministic policy still picks one). */
  eligibleLanes: ReadonlyArray<IntelligenceLane>;
  /** ModelChoice IDs that may serve this task when a model is needed. May be empty for instant/heuristic-only tasks. */
  eligibleModels: ReadonlyArray<ModelChoice>;
  /** Edge capabilities that may serve this task. May be empty when the task never goes to the edge. */
  eligibleEdgeCapabilities: ReadonlyArray<EdgeCapability>;
  /** Underlying low-level model task kind, when a model is involved. */
  modelTaskKind: TaskKind | null;
  /** Default weights used by scoring / abstention. */
  weights: CapabilityWeights;
  /** Whether output must be evidence-grounded. */
  grounding: GroundingRequirement;
  /** Hard ceiling on payload size (chars) the task is permitted to send off-device. */
  maxOffDevicePayloadChars: number;
}

const COMPOSER_INSTANT: IntelligenceTaskCapability = Object.freeze({
  task: 'composer_instant',
  eligibleLanes: Object.freeze(['browser_heuristic'] as const),
  eligibleModels: Object.freeze([] as const),
  eligibleEdgeCapabilities: Object.freeze([] as const),
  modelTaskKind: null,
  weights: Object.freeze({ cost: 0.0, latency: 0.0, privacy: 1.0, quality: 0.4 }),
  grounding: 'not_required',
  maxOffDevicePayloadChars: 0,
}) as IntelligenceTaskCapability;

const COMPOSER_REFINE: IntelligenceTaskCapability = Object.freeze({
  task: 'composer_refine',
  eligibleLanes: Object.freeze(['browser_heuristic', 'browser_small_ml', 'edge_classifier'] as const),
  eligibleModels: Object.freeze(['worker_local_only'] as const),
  eligibleEdgeCapabilities: Object.freeze(['composer_classify'] as const),
  modelTaskKind: 'hot_path_scoring',
  weights: Object.freeze({ cost: 0.1, latency: 0.2, privacy: 0.8, quality: 0.6 }),
  grounding: 'not_required',
  maxOffDevicePayloadChars: 800,
}) as IntelligenceTaskCapability;

const COMPOSER_WRITER: IntelligenceTaskCapability = Object.freeze({
  task: 'composer_writer',
  eligibleLanes: Object.freeze([
    'browser_small_ml',
    'browser_experimental',
    'server_writer',
    'premium_provider',
  ] as const),
  eligibleModels: Object.freeze(['qwen3_4b', 'smollm3_3b', 'phi4_mini'] as const),
  eligibleEdgeCapabilities: Object.freeze([] as const),
  modelTaskKind: 'text_generation',
  weights: Object.freeze({ cost: 0.55, latency: 0.55, privacy: 0.6, quality: 0.85 }),
  grounding: 'preferred',
  maxOffDevicePayloadChars: 8_000,
}) as IntelligenceTaskCapability;

const LOCAL_SEARCH: IntelligenceTaskCapability = Object.freeze({
  task: 'local_search',
  eligibleLanes: Object.freeze(['browser_small_ml', 'edge_reranker'] as const),
  eligibleModels: Object.freeze(['worker_local_only'] as const),
  eligibleEdgeCapabilities: Object.freeze(['search_rerank'] as const),
  modelTaskKind: 'hot_path_scoring',
  weights: Object.freeze({ cost: 0.1, latency: 0.15, privacy: 0.95, quality: 0.6 }),
  grounding: 'preferred',
  maxOffDevicePayloadChars: 0,
}) as IntelligenceTaskCapability;

const PUBLIC_SEARCH: IntelligenceTaskCapability = Object.freeze({
  task: 'public_search',
  eligibleLanes: Object.freeze(['browser_small_ml', 'edge_reranker'] as const),
  eligibleModels: Object.freeze(['worker_local_only'] as const),
  eligibleEdgeCapabilities: Object.freeze(['search_rerank'] as const),
  modelTaskKind: 'hot_path_scoring',
  weights: Object.freeze({ cost: 0.2, latency: 0.25, privacy: 0.55, quality: 0.7 }),
  grounding: 'preferred',
  maxOffDevicePayloadChars: 1_200,
}) as IntelligenceTaskCapability;

const MEDIA_ANALYSIS: IntelligenceTaskCapability = Object.freeze({
  task: 'media_analysis',
  eligibleLanes: Object.freeze(['browser_heuristic', 'edge_classifier'] as const),
  eligibleModels: Object.freeze(['qwen35_2b_mm', 'qwen35_08b_mm', 'qwen3_vl_4b'] as const),
  eligibleEdgeCapabilities: Object.freeze(['media_classify'] as const),
  modelTaskKind: 'multimodal_analysis',
  weights: Object.freeze({ cost: 0.5, latency: 0.5, privacy: 0.6, quality: 0.8 }),
  grounding: 'required',
  maxOffDevicePayloadChars: 800,
}) as IntelligenceTaskCapability;

const STORY_SUMMARY: IntelligenceTaskCapability = Object.freeze({
  task: 'story_summary',
  eligibleLanes: Object.freeze(['server_writer', 'premium_provider'] as const),
  eligibleModels: Object.freeze(['qwen3_4b', 'phi4_mini'] as const),
  eligibleEdgeCapabilities: Object.freeze(['story_summarize'] as const),
  modelTaskKind: 'text_generation',
  weights: Object.freeze({ cost: 0.7, latency: 0.6, privacy: 0.5, quality: 0.9 }),
  grounding: 'required',
  maxOffDevicePayloadChars: 8_000,
}) as IntelligenceTaskCapability;

const TASK_TABLE: Readonly<Record<IntelligenceTask, IntelligenceTaskCapability>> = Object.freeze({
  composer_instant: COMPOSER_INSTANT,
  composer_refine: COMPOSER_REFINE,
  composer_writer: COMPOSER_WRITER,
  local_search: LOCAL_SEARCH,
  public_search: PUBLIC_SEARCH,
  media_analysis: MEDIA_ANALYSIS,
  story_summary: STORY_SUMMARY,
});

/** Total lookup. Returns the capability descriptor for any `IntelligenceTask`. */
export function getTaskCapability(task: IntelligenceTask): IntelligenceTaskCapability {
  // Direct table access is safe because TASK_TABLE has every IntelligenceTask key.
  return TASK_TABLE[task];
}

/** All capability descriptors in stable enumeration order. */
export function listTaskCapabilities(): ReadonlyArray<IntelligenceTaskCapability> {
  return Object.freeze([
    COMPOSER_INSTANT,
    COMPOSER_REFINE,
    COMPOSER_WRITER,
    LOCAL_SEARCH,
    PUBLIC_SEARCH,
    MEDIA_ANALYSIS,
    STORY_SUMMARY,
  ]);
}

export function isLaneEligibleForTask(task: IntelligenceTask, lane: IntelligenceLane): boolean {
  return TASK_TABLE[task].eligibleLanes.includes(lane);
}

export function isModelEligibleForTask(task: IntelligenceTask, model: ModelChoice): boolean {
  return TASK_TABLE[task].eligibleModels.includes(model);
}

export function isEdgeCapabilityEligibleForTask(
  task: IntelligenceTask,
  capability: EdgeCapability,
): boolean {
  return TASK_TABLE[task].eligibleEdgeCapabilities.includes(capability);
}
