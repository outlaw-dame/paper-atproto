/**
 * Router orchestrator
 *
 * This is the single production entry point that actually exercises the
 * FunctionGemma router model from the architecture documented in
 * `docs/router-coordinator-architecture.md`. The router answers
 * "what should handle this bounded task?" — it selects a route inside the
 * deterministic coordination contract built from the model policy and
 * AI stack profile.
 *
 * Design constraints:
 *  - Deterministic policy is always authority. The router can only pick a
 *    route from `contract.allowedRoutes` where `allowed === true`.
 *  - The orchestrator is safe by default: if no FunctionGemma runtime is
 *    registered (or the runtime is unavailable), `invokeFunctionGemmaRouter`
 *    returns a deterministic fallback envelope and we keep the policy's
 *    primary route. This means wiring this into existing call sites does
 *    not change behaviour until a runtime is registered via
 *    `setFunctionGemmaRouterRuntime()`.
 *  - Every invocation emits an audit log so operators can see the router
 *    actually firing and which route it picked.
 */
import { selectAiStackProfile, type AiStackProfileOptions } from './aiStackProfile';
import type { RuntimeCapability } from './capabilityProbe';
import {
  buildCoordinationContract,
  type CoordinationContract,
  type CoordinationPathKind,
  type CoordinationRouteId,
  type CoordinationRouteOption,
} from './routerCoordinatorContract';
import {
  invokeFunctionGemmaRouter,
  type FunctionGemmaRouterInvocationResult,
  type FunctionGemmaRouterInvocationStatus,
  type FunctionGemmaRouterRuntime,
} from './functionGemmaRouterInvoker';
import { chooseModelForTask, type ModelChoice, type ModelPolicyDecision, type RuntimeMode, type TaskKind } from './modelPolicy';
import type { RouterPromptInput } from './prompts';
import { emitIntelligenceEvent } from '../intelligence/coordinator/intelligenceEvents';
import type { IntelligenceLane } from '../intelligence/intelligenceRoutingPolicy';

function coordinationKindToLane(kind: CoordinationPathKind): IntelligenceLane {
  switch (kind) {
    case 'local_worker':
    case 'local_generation':
    case 'local_multimodal': return 'browser_small_ml';
    case 'remote_fallback': return 'server_writer';
    case 'deterministic_only': return 'browser_heuristic';
  }
}

let activeRouterRuntime: FunctionGemmaRouterRuntime | null = null;

export function setFunctionGemmaRouterRuntime(runtime: FunctionGemmaRouterRuntime | null): void {
  activeRouterRuntime = runtime;
}

export function getFunctionGemmaRouterRuntime(): FunctionGemmaRouterRuntime | null {
  return activeRouterRuntime;
}

export interface RouteTaskRuntimeHealth {
  batterySaver?: boolean;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
  sustainedLatencyMs?: number | null;
  storageAvailableGiB?: number | null;
}

export interface RouteTaskInputStats {
  textLength?: number;
  estimatedPromptTokens?: number;
  hasImages?: boolean;
  hasLinks?: boolean;
  hasCode?: boolean;
  hasSensitiveLocalData?: boolean;
}

export interface RouteTaskWithRouterOptions {
  task: TaskKind;
  capability: RuntimeCapability;
  settingsMode: RuntimeMode;
  explicitUserAction?: boolean;
  taskSummary?: string;
  userVisibleIntent?: string;
  inputStats?: RouteTaskInputStats;
  runtimeHealth?: RouteTaskRuntimeHealth;
  stackProfileOptions?: Partial<AiStackProfileOptions>;
  contractTtlMs?: number;
  invocationTimeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Override the router runtime for this single call. Defaults to the
   * runtime registered via `setFunctionGemmaRouterRuntime`.
   */
  runtime?: FunctionGemmaRouterRuntime | null;
  /** Suppress the audit log for this call (used by tests). */
  silent?: boolean;
}

export interface RouteTaskWithRouterResult {
  task: TaskKind;
  contractId: string;
  status: FunctionGemmaRouterInvocationStatus;
  selectedRoute: CoordinationRouteOption;
  selectedRouteId: CoordinationRouteId;
  /** Concrete model choice the route resolves to, if any. `null` for deterministic-only routes. */
  selectedModel: ModelChoice | null;
  /** Ordered list of `ModelChoice` candidates to attempt — selected first, then policy fallbacks. */
  modelCandidates: ModelChoice[];
  policyDecision: ModelPolicyDecision;
  contract: CoordinationContract;
  invocation: FunctionGemmaRouterInvocationResult;
  /**
   * `true` when the router model did not produce a valid decision and the
   * orchestrator returned the deterministic policy primary route. Useful for
   * audit dashboards and tests.
   */
  deterministicFallback: boolean;
  durationMs: number;
}

function buildContractId(task: TaskKind, nowEpochMs: number): string {
  const random = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${nowEpochMs}-${Math.floor(Math.random() * 1_000_000)}`;
  return `coord:${task}:${random}`;
}

function buildPromptInput(params: {
  contractId: string;
  contract: CoordinationContract;
  options: RouteTaskWithRouterOptions;
}): RouterPromptInput {
  const { contractId, contract, options } = params;
  return {
    contractId,
    contract,
    taskSummary: (options.taskSummary ?? options.task).slice(0, 500),
    userVisibleIntent: (options.userVisibleIntent ?? '').slice(0, 500),
    inputStats: {
      textLength: options.inputStats?.textLength ?? 0,
      estimatedPromptTokens: options.inputStats?.estimatedPromptTokens ?? 0,
      hasImages: options.inputStats?.hasImages ?? false,
      hasLinks: options.inputStats?.hasLinks ?? false,
      hasCode: options.inputStats?.hasCode ?? false,
      hasSensitiveLocalData: options.inputStats?.hasSensitiveLocalData ?? false,
    },
    runtimeHealth: {
      batterySaver: options.runtimeHealth?.batterySaver ?? false,
      thermalState: options.runtimeHealth?.thermalState ?? 'nominal',
      sustainedLatencyMs: options.runtimeHealth?.sustainedLatencyMs ?? null,
      storageAvailableGiB: options.runtimeHealth?.storageAvailableGiB ?? null,
    },
  };
}

function buildModelCandidates(params: {
  selectedModel: ModelChoice | null;
  policyDecision: ModelPolicyDecision;
}): ModelChoice[] {
  const ordered: ModelChoice[] = [];
  if (params.selectedModel && params.selectedModel !== 'worker_local_only') {
    ordered.push(params.selectedModel);
  }
  if (params.policyDecision.choice && !ordered.includes(params.policyDecision.choice)) {
    ordered.push(params.policyDecision.choice);
  }
  for (const choice of params.policyDecision.fallbackChoices) {
    if (!ordered.includes(choice)) ordered.push(choice);
  }
  return ordered;
}

function logRouterAudit(result: RouteTaskWithRouterResult): void {
  // Single, structured audit line. Keep payload small and free of PII.
  // eslint-disable-next-line no-console
  console.info('[router/audit]', {
    task: result.task,
    contractId: result.contractId,
    status: result.status,
    selectedRouteId: result.selectedRouteId,
    selectedModel: result.selectedModel,
    deterministicFallback: result.deterministicFallback,
    durationMs: result.durationMs,
    runtimeAvailable: result.invocation.diagnostics.runtimeAvailable,
    timedOut: result.invocation.diagnostics.timedOut,
    aborted: result.invocation.diagnostics.aborted,
    fallbackReason: result.invocation.execution.fallbackReason,
  });
}

function emitRouterIntelligenceEvent(result: RouteTaskWithRouterResult): void {
  // Unified intelligence_event envelope (see src/intelligence/coordinator/intelligenceEvents.ts).
  // Emitted in addition to the [router/audit] console line so dashboards
  // see every router decision, not just those routed through the
  // intelligenceCoordinator facade.
  const reasonCodes: string[] = [`router_status_${result.status}`];
  if (result.deterministicFallback) reasonCodes.push('router_deterministic_fallback');
  if (result.invocation.diagnostics.timedOut) reasonCodes.push('router_timed_out');
  if (result.invocation.diagnostics.aborted) reasonCodes.push('router_aborted');
  const fallbackReason = result.invocation.execution.fallbackReason;
  if (fallbackReason) reasonCodes.push(`router_fb_${fallbackReason}`);

  const status = result.invocation.diagnostics.aborted
    ? 'aborted'
    : result.deterministicFallback
      ? 'fallback'
      : 'planned';

  emitIntelligenceEvent({
    surface: 'router',
    lane: coordinationKindToLane(result.selectedRoute.kind),
    model: result.selectedModel,
    status,
    durationMs: result.durationMs,
    deterministicFallback: result.deterministicFallback,
    reasonCodes,
    details: {
      contract_id: result.contractId,
      route_id: result.selectedRouteId,
      task_kind: result.task,
      runtime_available: result.invocation.diagnostics.runtimeAvailable,
    },
  });
}

/**
 * Run the router for a bounded task and return the selected route plus the
 * ordered model-candidate list the caller should attempt to load.
 *
 * Safe by default: when no FunctionGemma runtime is registered, this returns
 * the deterministic policy primary as the selected route.
 */
export async function routeTaskWithRouter(
  options: RouteTaskWithRouterOptions,
): Promise<RouteTaskWithRouterResult> {
  const startedAt = Date.now();
  const policyDecision = chooseModelForTask({
    capability: options.capability,
    settingsMode: options.settingsMode,
    task: options.task,
    ...(typeof options.explicitUserAction === 'boolean' ? { explicitUserAction: options.explicitUserAction } : {}),
  });

  const stackProfile = selectAiStackProfile(options.capability, {
    settingsMode: options.settingsMode,
    ...options.stackProfileOptions,
  });

  const contractId = buildContractId(options.task, startedAt);
  const contract = buildCoordinationContract({
    policyDecision,
    stackProfile,
    nowEpochMs: startedAt,
    ...(options.contractTtlMs !== undefined ? { ttlMs: options.contractTtlMs } : {}),
  });

  const promptInput = buildPromptInput({ contractId, contract, options });
  const runtime = options.runtime ?? activeRouterRuntime;

  const invocation = await invokeFunctionGemmaRouter({
    contract,
    contractId,
    promptInput,
    runtime,
    ...(options.invocationTimeoutMs !== undefined ? { timeoutMs: options.invocationTimeoutMs } : {}),
    nowEpochMs: startedAt,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const selectedRoute = resolveSelectedRoute({ contract, invocation });
  const selectedModel = selectedRoute.model ?? null;
  const deterministicFallback = invocation.status !== 'accepted';

  const result: RouteTaskWithRouterResult = {
    task: options.task,
    contractId,
    status: invocation.status,
    selectedRoute,
    selectedRouteId: selectedRoute.id,
    selectedModel,
    modelCandidates: buildModelCandidates({ selectedModel, policyDecision }),
    policyDecision,
    contract,
    invocation,
    deterministicFallback,
    durationMs: Date.now() - startedAt,
  };

  if (!options.silent) {
    logRouterAudit(result);
    emitRouterIntelligenceEvent(result);
  }
  return result;
}

/**
 * When the router model is genuinely unavailable (no runtime registered),
 * we want the orchestrator to emit the *primary* policy route — i.e. the
 * deterministic baseline — rather than the contract's safety fallback. The
 * existing `routerExecutionAdapter.selectFallbackRoute` deliberately prefers
 * `contract.fallbackRouteId` because it is designed to react to *bad* router
 * output, not absent router output. For 'unavailable' status we override
 * that to use the primary policy route from `contract.defaultRouteId`.
 */
function resolveSelectedRoute(params: {
  contract: CoordinationContract;
  invocation: FunctionGemmaRouterInvocationResult;
}): CoordinationRouteOption {
  const { contract, invocation } = params;
  if (invocation.status === 'unavailable') {
    const primary = contract.allowedRoutes.find(
      (route) => route.id === contract.defaultRouteId && route.allowed,
    );
    if (primary) return primary;
  }
  return invocation.execution.selectedRoute;
}
