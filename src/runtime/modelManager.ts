import { probeRuntimeCapability, type RuntimeCapability } from './capabilityProbe';
import {
  type ModelChoice,
  type ModelPolicyDecision,
  type TaskKind,
} from './modelPolicy';
import { LocalGenerationSession, type GenerateTextRequest } from './generationSession';
import { LocalMultimodalSession, type AnalyzeMediaRequest } from './multimodalSession';
import { runRuntimeSmokeCheck, type RuntimeSmokeReport } from './runtimeSmoke';
import { useRuntimeStore } from './runtimeStore';
import {
  routeTaskWithRouter,
  type RouteTaskInputStats,
  type RouteTaskWithRouterResult,
} from './routerOrchestrator';

type SessionKind = 'text' | 'multimodal';

type ModelSpec = {
  choice: Exclude<ModelChoice, 'worker_local_only'>;
  label: string;
  sessionKind: SessionKind;
  modelId: string;
  localOnly: boolean;
  preferredDevice?: 'webgpu' | 'wasm';
  runtimeNote?: string;
  currentRuntimeSupport: 'ready' | 'experimental' | 'planned';
};

type ActiveSession = {
  choice: Exclude<ModelChoice, 'worker_local_only'>;
  kind: SessionKind;
  instance: LocalGenerationSession | LocalMultimodalSession;
};

type SuccessfulLocalResult<T extends 'text' | 'multimodal'> = {
  ok: true;
  source: 'local';
  model: Exclude<ModelChoice, 'worker_local_only'>;
} & (T extends 'text'
  ? { text: string }
  : { summary: string });

type UnavailableResult = {
  ok: false;
  source: 'unavailable';
  fallback: 'remote' | 'none';
  reason: string;
};

export type ModelManagerTextResult = SuccessfulLocalResult<'text'> | UnavailableResult;
export type ModelManagerMultimodalResult = SuccessfulLocalResult<'multimodal'> | UnavailableResult;

const MODEL_SWITCH_COOLDOWN_MS = 90_000;
const TEXT_IDLE_UNLOAD_MS = 8 * 60_000;
const MULTIMODAL_IDLE_UNLOAD_MS = 90_000;

const MODEL_SPECS: Record<Exclude<ModelChoice, 'worker_local_only'>, ModelSpec> = {
  qwen3_4b: {
    choice: 'qwen3_4b',
    label: 'Qwen3-4B Instruct',
    sessionKind: 'text',
    modelId: 'onnx-community/Qwen3-4B-Instruct-2507-ONNX',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'experimental',
  },
  smollm3_3b: {
    choice: 'smollm3_3b',
    label: 'SmolLM3-3B',
    sessionKind: 'text',
    modelId: 'HuggingFaceTB/SmolLM3-3B-ONNX',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'ready',
  },
  phi4_mini: {
    choice: 'phi4_mini',
    label: 'Phi-4 mini',
    sessionKind: 'text',
    modelId: 'microsoft/phi-4-onnx',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'planned',
    runtimeNote: 'This repo does not yet stage a browser-ready Phi-4 mini packaging path.',
  },
  qwen3_vl_4b: {
    choice: 'qwen3_vl_4b',
    label: 'Qwen3-VL-4B',
    sessionKind: 'multimodal',
    modelId: 'onnx-community/Qwen3-4B-VL-ONNX',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'planned',
    runtimeNote: 'The installed browser runtime does not yet support local VLM chat safely enough for this model.',
  },
  qwen35_2b_mm: {
    choice: 'qwen35_2b_mm',
    label: 'Qwen3.5-2B multimodal',
    sessionKind: 'multimodal',
    modelId: 'onnx-community/Qwen3.5-2B-ONNX',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'planned',
    runtimeNote: 'Qwen3.5-2B multimodal assets can be staged locally, but the browser multimodal session remains intentionally disabled until the local VLM runtime path is implemented safely.',
  },
  qwen35_08b_mm: {
    choice: 'qwen35_08b_mm',
    label: 'Qwen3.5-0.8B multimodal',
    sessionKind: 'multimodal',
    modelId: 'onnx-community/Qwen3.5-0.8B-ONNX',
    localOnly: true,
    preferredDevice: 'webgpu',
    currentRuntimeSupport: 'planned',
    runtimeNote: 'Qwen3.5 multimodal local browser support still needs a newer runtime path before it is safe to enable here.',
  },
};

class BrowserModelManager {
  private activeSession: ActiveSession | null = null;
  private idleTimer: number | null = null;

  async initCapabilityProbe(force = false): Promise<RuntimeCapability> {
    const store = useRuntimeStore.getState();
    if (!force && store.capability) {
      return store.capability;
    }

    store.startCapabilityProbe();
    const capability = await probeRuntimeCapability();
    useRuntimeStore.getState().finishCapabilityProbe(capability);
    return capability;
  }

  async runRuntimeSmokeCheck(): Promise<RuntimeSmokeReport> {
    useRuntimeStore.getState().startRuntimeSmokeCheck();
    const report = await runRuntimeSmokeCheck();
    useRuntimeStore.getState().finishRuntimeSmokeCheck(report);
    return report;
  }

  async generate(request: GenerateTextRequest): Promise<ModelManagerTextResult> {
    return this.runTextGeneration(request);
  }

  async analyzeMedia(request: AnalyzeMediaRequest): Promise<ModelManagerMultimodalResult> {
    return this.runMultimodalAnalysis(request);
  }

  async unloadActiveModel(): Promise<void> {
    this.clearIdleTimer();
    const current = this.activeSession;
    this.activeSession = null;
    useRuntimeStore.getState().setActiveModel(null);
    if (!current) return;
    await current.instance.dispose();
  }

  getResolvedModelSpecs(): Record<string, Pick<ModelSpec, 'label' | 'sessionKind' | 'currentRuntimeSupport' | 'runtimeNote'>> {
    return Object.fromEntries(
      Object.entries(MODEL_SPECS).map(([choice, spec]) => [
        choice,
        {
          label: spec.label,
          sessionKind: spec.sessionKind,
          currentRuntimeSupport: spec.currentRuntimeSupport,
          ...(spec.runtimeNote ? { runtimeNote: spec.runtimeNote } : {}),
        },
      ]),
    );
  }

  private async runTextGeneration(request: GenerateTextRequest): Promise<ModelManagerTextResult> {
    const capability = await this.ensureCapability();
    const routing = await this.routeTask('text_generation', capability, {
      textLength: request.prompt?.length ?? 0,
    });
    const decision = routing.policyDecision;

    if (!decision.localAllowed || decision.choice === 'worker_local_only') {
      return unavailable(decision.reason);
    }

    const candidates = this.getLoadableCandidates(routing);
    if (candidates.length === 0) {
      return unavailable(this.getUnavailableReason(decision));
    }

    let lastError: unknown;

    for (const choice of candidates) {
      try {
        const session = await this.ensureSession(choice);
        if (!(session.instance instanceof LocalGenerationSession)) {
          lastError = new Error('The selected local text generation session is unavailable.');
          continue;
        }

        useRuntimeStore.getState().touchActivity();
        const result = await session.instance.generate(request);
        this.scheduleIdleUnload(TEXT_IDLE_UNLOAD_MS);
        return {
          ok: true,
          source: 'local',
          model: choice,
          text: result.text,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return unavailable(lastError instanceof Error ? lastError.message : this.getUnavailableReason(decision));
  }

  private async runMultimodalAnalysis(request: AnalyzeMediaRequest): Promise<ModelManagerMultimodalResult> {
    const capability = await this.ensureCapability();
    const routing = await this.routeTask('multimodal_analysis', capability, {
      hasImages: true,
    });
    const decision = routing.policyDecision;

    if (!decision.localAllowed || decision.choice === 'worker_local_only') {
      return unavailable(decision.reason);
    }

    const candidates = this.getLoadableCandidates(routing);
    if (candidates.length === 0) {
      return unavailable(this.getUnavailableReason(decision));
    }

    let lastError: unknown;

    for (const choice of candidates) {
      try {
        const session = await this.ensureSession(choice);
        if (!(session.instance instanceof LocalMultimodalSession)) {
          lastError = new Error('The selected local multimodal session is unavailable.');
          continue;
        }

        useRuntimeStore.getState().touchActivity();
        const result = await session.instance.analyzeMedia(request);
        this.scheduleIdleUnload(MULTIMODAL_IDLE_UNLOAD_MS);
        return {
          ok: true,
          source: 'local',
          model: choice,
          summary: result.summary,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return unavailable(lastError instanceof Error ? lastError.message : this.getUnavailableReason(decision));
  }

  private async ensureCapability(): Promise<RuntimeCapability> {
    const store = useRuntimeStore.getState();
    if (store.capability) return store.capability;
    return this.initCapabilityProbe();
  }

  private getLoadableCandidates(
    routing: RouteTaskWithRouterResult,
  ): Array<Exclude<ModelChoice, 'worker_local_only'>> {
    const candidates = routing.modelCandidates.filter(
      (choice): choice is Exclude<ModelChoice, 'worker_local_only'> => choice !== 'worker_local_only',
    );
    const store = useRuntimeStore.getState();
    const viable: Array<Exclude<ModelChoice, 'worker_local_only'>> = [];

    for (const choice of candidates) {
      const spec = MODEL_SPECS[choice];
      if (!spec) continue;

      if (store.isModelCoolingDown(choice)) {
        continue;
      }

      const sessionReason = store.getModelUnavailableReason(choice);
      if (sessionReason) {
        continue;
      }

      if (spec.currentRuntimeSupport === 'planned') {
        continue;
      }

      viable.push(choice);
    }

    return viable;
  }

  private async routeTask(
    task: TaskKind,
    capability: RuntimeCapability,
    inputStats: RouteTaskInputStats = {},
  ): Promise<RouteTaskWithRouterResult> {
    const store = useRuntimeStore.getState();
    return routeTaskWithRouter({
      task,
      capability,
      settingsMode: store.settingsMode,
      explicitUserAction: true,
      inputStats,
      stackProfileOptions: {
        allowLiteRt: store.allowLiteRt,
        preferLiteRt: store.preferLiteRt,
        userConsentedToLargeModels: store.userConsentedToLargeModels,
      },
    });
  }

  private getUnavailableReason(decision: ModelPolicyDecision): string {
    return decision.remoteFallbackAllowed
      ? 'No compatible local browser model is currently ready, so the feature should fall back to remote enhancement.'
      : decision.reason;
  }

  private async ensureSession(choice: Exclude<ModelChoice, 'worker_local_only'>): Promise<ActiveSession> {
    if (this.activeSession?.choice === choice) {
      useRuntimeStore.getState().setActiveModel(choice);
      useRuntimeStore.getState().setLoadState('ready');
      return this.activeSession;
    }

    await this.unloadActiveModel();
    useRuntimeStore.getState().setLoadState('loading');
    useRuntimeStore.getState().setActiveModel(choice);

    const spec = MODEL_SPECS[choice];
    const instance = spec.sessionKind === 'text'
      ? new LocalGenerationSession({
          modelId: spec.modelId,
          label: spec.label,
          localOnly: spec.localOnly,
          ...(spec.preferredDevice ? { device: spec.preferredDevice } : {}),
        })
      : new LocalMultimodalSession({
          modelId: spec.modelId,
          label: spec.label,
          ...(spec.runtimeNote ? { runtimeNote: spec.runtimeNote } : {}),
        });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await instance.load();
        this.activeSession = {
          choice,
          kind: spec.sessionKind,
          instance,
        };
        useRuntimeStore.getState().setLoadState('ready');
        useRuntimeStore.getState().touchActivity();
        return this.activeSession;
      } catch (error) {
        await instance.dispose();
        if (attempt === 0) {
          continue;
        }
        await this.handleModelFailure(choice, error, MODEL_SWITCH_COOLDOWN_MS);
        throw error;
      }
    }

    throw new Error(`${spec.label} could not be loaded.`);
  }

  private async handleModelFailure(
    choice: Exclude<ModelChoice, 'worker_local_only'>,
    error: unknown,
    cooldownMs: number,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : 'Model runtime failed.';
    const lowered = message.toLowerCase();
    const failureClass = lowered.includes('out of memory') || lowered.includes('oom')
      ? 'memory_pressure'
      : lowered.includes('timed out') || lowered.includes('timeout')
        ? 'timeout'
        : lowered.includes('missing required local model asset')
          ? 'integrity_failure'
          : 'runtime_failure';
    const adjustedCooldownMs = failureClass === 'memory_pressure'
      ? Math.max(cooldownMs, 3 * 60_000)
      : cooldownMs;

    await this.unloadActiveModel();
    useRuntimeStore.getState().recordModelCooldown(choice, adjustedCooldownMs, `${failureClass}: ${message}`);
    console.warn('[Runtime][ModelFailure]', {
      model: choice,
      failureClass,
      cooldownMs: adjustedCooldownMs,
      message,
      at: new Date().toISOString(),
    });
  }

  private scheduleIdleUnload(timeoutMs: number): void {
    this.clearIdleTimer();
    this.idleTimer = window.setTimeout(() => {
      void this.unloadActiveModel().catch((error) => {
        console.warn('[Runtime] Failed to unload idle model', error);
      });
    }, timeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

function unavailable(reason: string): UnavailableResult {
  return {
    ok: false,
    source: 'unavailable',
    fallback: 'remote',
    reason,
  };
}

export const browserModelManager = new BrowserModelManager();
