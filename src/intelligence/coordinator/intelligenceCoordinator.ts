/**
 * IntelligenceCoordinator — the single facade every surface
 * (session, composer, search, discovery, media, sports) consults to get
 * a routing decision plus the standard telemetry event.
 *
 * What this module *does*:
 *   • Composes the existing deterministic lane policy
 *     (`chooseIntelligenceLane`), the router orchestrator
 *     (`routeTaskWithRouter`), and the edge provider planner
 *     (`planEdgeExecution`) — without re-implementing any of them.
 *   • Normalizes inputs through {@link SessionBrief}.
 *   • Cross-checks the lane against the {@link capabilityRegistry} and
 *     records a registry-mismatch reason code if the policy ever returns
 *     a lane that isn't eligible for the task (defence in depth).
 *   • Emits a single {@link IntelligenceEvent} per advise call.
 *
 * What this module *does not* do:
 *   • Any prompting, content generation, or HTTP. The facade returns an
 *     advice object; the surface code performs the actual call.
 *   • Any side-effecting state mutation. Two concurrent calls produce
 *     independent advice objects.
 *   • Any retry. The router orchestrator handles its own bounded retry
 *     and timeout; layering another retry here would amplify failures.
 */
import {
  chooseIntelligenceLane,
  type IntelligenceLane,
  type IntelligenceRoutingDecision,
  type IntelligenceTask,
} from '../intelligenceRoutingPolicy';
import { planEdgeExecution } from '../edge/edgeProviderPlanner';
import type { EdgeExecutionPlan } from '../edge/edgeProviderContracts';
import type { ModelChoice, RuntimeMode, TaskKind } from '../../runtime/modelPolicy';
import {
  routeTaskWithRouter,
  type RouteTaskWithRouterResult,
} from '../../runtime/routerOrchestrator';
import type { RuntimeCapability } from '../../runtime/capabilityProbe';
import {
  emitIntelligenceEvent,
  type IntelligenceEvent,
  type IntelligenceStatus,
  type IntelligenceSurface,
} from './intelligenceEvents';
import { isLaneEligibleForTask } from './capabilityRegistry';
import type { SessionBrief } from './sessionBrief';

export interface IntelligenceAdvice {
  /** Echo of the brief used to compute this advice. */
  brief: SessionBrief;
  /** Lane the deterministic policy chose (always present). */
  lane: IntelligenceLane;
  /** Optional fallback lane if the primary lane fails. */
  fallbackLane?: IntelligenceLane;
  /** Stable reason code from the deterministic policy. */
  laneReasonCode: IntelligenceRoutingDecision['reasonCode'];
  /** Edge execution plan when the task is eligible for the edge. */
  edgePlan?: EdgeExecutionPlan;
  /** Router orchestrator result when a model task fired. */
  routerResult?: RouteTaskWithRouterResult;
  /** Ordered model candidates (router pick first, then policy fallbacks). */
  modelCandidates: ReadonlyArray<ModelChoice>;
  /** Aggregated reason codes across policy / registry / router. */
  reasonCodes: ReadonlyArray<string>;
  /** True when the deterministic policy primary was used (no learned route). */
  deterministicFallback: boolean;
  /** The single intelligence event emitted for this advice. */
  event: IntelligenceEvent;
}

export interface AdviseOptions {
  signal?: AbortSignal;
  /**
   * Suppress the router orchestrator's own console audit line; the facade
   * still emits its `IntelligenceEvent`.
   */
  silentRouterAudit?: boolean;
  /** Override settings-mode for the underlying model policy when the brief lacks one. */
  settingsModeOverride?: RuntimeMode;
  /**
   * If provided, advice is short-circuited to a `stale_discarded` event
   * when the brief's source token does not match. The facade still
   * returns a defensible advice (deterministic policy lane, no router,
   * no edge) and tags `stale_source_token` so callers can drop it.
   */
  expectedSourceToken?: string;
}

const TASK_TO_KIND: Readonly<Record<IntelligenceTask, TaskKind | null>> = Object.freeze({
  composer_instant: null,
  composer_refine: 'hot_path_scoring',
  composer_writer: 'text_generation',
  local_search: 'hot_path_scoring',
  public_search: 'hot_path_scoring',
  media_analysis: 'multimodal_analysis',
  story_summary: 'text_generation',
});

const SURFACE_BY_INTENT: Readonly<Record<IntelligenceTask, IntelligenceSurface>> = Object.freeze({
  composer_instant: 'composer',
  composer_refine: 'composer',
  composer_writer: 'composer',
  local_search: 'search',
  public_search: 'search',
  media_analysis: 'media',
  story_summary: 'session',
});

function deriveStatus(params: {
  intent: IntelligenceTask;
  router: RouteTaskWithRouterResult | undefined;
  edgePlan: EdgeExecutionPlan | undefined;
}): IntelligenceStatus {
  if (!params.router) return params.edgePlan ? 'planned' : 'planned';
  if (params.router.invocation.diagnostics.aborted) return 'aborted';
  if (params.router.deterministicFallback) return 'fallback';
  return 'planned';
}

function buildLanePolicyInput(brief: SessionBrief): Parameters<typeof chooseIntelligenceLane>[0] {
  return {
    task: brief.intent,
    privacyMode: brief.privacy,
    dataScope: brief.scope,
    deviceTier: brief.deviceTier,
    ...(brief.capability?.deviceMemoryGiB != null
      ? { deviceMemoryGiB: brief.capability.deviceMemoryGiB }
      : {}),
    ...(brief.explicitUserAction ? { explicitUserAction: true } : {}),
    ...(brief.entitlements?.providerAvailable ? { premiumAvailable: true } : {}),
  };
}

async function runRouterIfApplicable(
  brief: SessionBrief,
  options: AdviseOptions,
): Promise<RouteTaskWithRouterResult | undefined> {
  const taskKind = TASK_TO_KIND[brief.intent];
  if (!taskKind) return undefined;
  if (!brief.capability) return undefined;
  // Match modelManager.ts: the router only advises model tasks. Hot-path
  // scoring stays on the worker pipeline so we don't generate noise audit
  // entries for every keystroke or search rerank.
  if (taskKind === 'hot_path_scoring') return undefined;

  try {
    return await routeTaskWithRouter({
      task: taskKind,
      capability: brief.capability,
      settingsMode: options.settingsModeOverride ?? brief.settingsMode,
      explicitUserAction: brief.explicitUserAction,
      taskSummary: brief.intent,
      inputStats: {
        textLength: brief.textLength,
        estimatedPromptTokens: brief.estimatedPromptTokens,
        hasImages: brief.attachments.hasImages,
        hasLinks: brief.attachments.hasLinks,
        hasCode: brief.attachments.hasCode,
        hasSensitiveLocalData: brief.hasSensitiveLocalData,
      },
      runtimeHealth: {
        batterySaver: brief.runtimeHealth.batterySaver,
        thermalState: brief.runtimeHealth.thermalState,
        sustainedLatencyMs: brief.runtimeHealth.sustainedLatencyMs,
        storageAvailableGiB: brief.runtimeHealth.storageAvailableGiB,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.silentRouterAudit ? { silent: true } : {}),
    });
  } catch {
    // The orchestrator itself is designed not to throw, but if anything
    // upstream of it does we degrade to a deterministic-only advice.
    return undefined;
  }
}

function summarizeReasonCodes(params: {
  laneReason: string;
  registryMismatch: boolean;
  router: RouteTaskWithRouterResult | undefined;
  edgePlan: EdgeExecutionPlan | undefined;
}): ReadonlyArray<string> {
  const codes: string[] = [params.laneReason];
  if (params.registryMismatch) codes.push('lane_not_in_registry');
  if (params.router) {
    codes.push(`router_status_${params.router.status}`);
    if (params.router.deterministicFallback) codes.push('router_deterministic_fallback');
  }
  if (params.edgePlan) codes.push(`edge_${params.edgePlan.capability}_${params.edgePlan.provider}`);
  return Object.freeze(codes);
}

async function adviseInternal(brief: SessionBrief, options: AdviseOptions): Promise<IntelligenceAdvice> {
  const startedAt = Date.now();
  const policy = chooseIntelligenceLane(buildLanePolicyInput(brief));
  const registryMismatch = !isLaneEligibleForTask(brief.intent, policy.lane);

  // Stale-source-token guard: when the caller knows what token the brief
  // *should* carry and it doesn't match, short-circuit. We still return a
  // valid advice (lane derived from the deterministic policy) but mark
  // the event as `stale_discarded` and add a reason code so the caller
  // can drop the result without further computation.
  const stale =
    typeof options.expectedSourceToken === 'string' &&
    options.expectedSourceToken.length > 0 &&
    options.expectedSourceToken !== (brief.freshness.sourceToken ?? '');

  const edgePlan = stale
    ? undefined
    : (() => {
        try {
          return planEdgeExecution(buildLanePolicyInput(brief)) ?? undefined;
        } catch {
          return undefined;
        }
      })();

  const router = stale ? undefined : await runRouterIfApplicable(brief, options);

  const modelCandidates: ReadonlyArray<ModelChoice> = router
    ? Object.freeze([...router.modelCandidates])
    : Object.freeze([]);

  const reasonCodes = (() => {
    const codes = [
      ...summarizeReasonCodes({
        laneReason: policy.reasonCode,
        registryMismatch,
        router,
        edgePlan,
      }),
    ];
    if (stale) codes.unshift('stale_source_token');
    return Object.freeze(codes);
  })();

  const surface: IntelligenceSurface = SURFACE_BY_INTENT[brief.intent];
  const event = emitIntelligenceEvent({
    surface,
    task: brief.intent,
    lane: policy.lane,
    ...(router?.selectedModel !== undefined ? { model: router.selectedModel } : {}),
    status: stale ? 'stale_discarded' : deriveStatus({ intent: brief.intent, router, edgePlan }),
    durationMs: Date.now() - startedAt,
    deterministicFallback: router?.deterministicFallback ?? !router,
    reasonCodes,
    ...(brief.sessionId ? { sessionId: brief.sessionId } : {}),
    ...(brief.freshness.sourceToken ? { sourceToken: brief.freshness.sourceToken } : {}),
    details: {
      privacy: brief.privacy,
      scope: brief.scope,
      device_tier: brief.deviceTier,
      ...(edgePlan ? { edge_provider: edgePlan.provider } : {}),
    },
  });

  const advice: IntelligenceAdvice = {
    brief,
    lane: policy.lane,
    ...(policy.fallbackLane ? { fallbackLane: policy.fallbackLane } : {}),
    laneReasonCode: policy.reasonCode,
    ...(edgePlan ? { edgePlan } : {}),
    ...(router ? { routerResult: router } : {}),
    modelCandidates,
    reasonCodes,
    deterministicFallback: router ? router.deterministicFallback : true,
    event,
  };

  return Object.freeze(advice);
}

export interface IntelligenceCoordinator {
  adviseOnSession(brief: SessionBrief, options?: AdviseOptions): Promise<IntelligenceAdvice>;
  adviseOnSearch(brief: SessionBrief, options?: AdviseOptions): Promise<IntelligenceAdvice>;
  adviseOnComposer(brief: SessionBrief, options?: AdviseOptions): Promise<IntelligenceAdvice>;
  adviseOnDiscovery(brief: SessionBrief, options?: AdviseOptions): Promise<IntelligenceAdvice>;
  adviseOnMedia(brief: SessionBrief, options?: AdviseOptions): Promise<IntelligenceAdvice>;
}

function adviseOnSurface(
  expectedSurfaces: ReadonlyArray<IntelligenceSurface>,
): (brief: SessionBrief, options?: AdviseOptions) => Promise<IntelligenceAdvice> {
  return async (brief, options = {}) => {
    const surface = SURFACE_BY_INTENT[brief.intent];
    if (!expectedSurfaces.includes(surface)) {
      // Defence-in-depth: surfaces should always advise on their own
      // intents, but if a caller passes the wrong intent we still produce
      // a valid advice — we just tag a reason code so dashboards see it.
      const advice = await adviseInternal(brief, options);
      // We can't mutate the frozen advice, so re-emit a follow-up event
      // explaining the mismatch — keeps the original advice traceable.
      emitIntelligenceEvent({
        surface,
        task: brief.intent,
        status: 'skipped',
        reasonCodes: ['surface_intent_mismatch', ...advice.reasonCodes],
        ...(brief.sessionId ? { sessionId: brief.sessionId } : {}),
      });
      return advice;
    }
    return adviseInternal(brief, options);
  };
}

export const intelligenceCoordinator: IntelligenceCoordinator = Object.freeze({
  adviseOnSession: adviseOnSurface(['session']),
  adviseOnSearch: adviseOnSurface(['search']),
  adviseOnComposer: adviseOnSurface(['composer']),
  adviseOnDiscovery: adviseOnSurface(['search', 'discovery']),
  adviseOnMedia: adviseOnSurface(['media']),
});

/** Test seam: low-level advise without surface-intent gate. Do not call from production code. */
export function __adviseInternalForTesting(
  brief: SessionBrief,
  options: AdviseOptions = {},
): Promise<IntelligenceAdvice> {
  return adviseInternal(brief, options);
}
