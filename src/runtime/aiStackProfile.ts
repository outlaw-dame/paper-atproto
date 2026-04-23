import type { RuntimeCapability } from './capabilityProbe';
import type { RuntimeMode } from './modelPolicy';

export type AiStackTier =
  | 'baseline'
  | 'browser_default'
  | 'edge_strong'
  | 'edge_premium';

export type AiRuntimeId = 'deterministic' | 'webllm' | 'litert';

export type RouterModelId = 'deterministic_policy' | 'functiongemma_270m';

export type CoordinatorModelId =
  | 'none'
  | 'smollm2_1_7b'
  | 'gemma4_e2b'
  | 'gemma4_e4b'
  | 'phi4_mini';

export type AiStackDegradeReason =
  | 'no_webgpu'
  | 'generation_disabled'
  | 'battery_saver'
  | 'thermal_pressure'
  | 'latency_regression'
  | 'storage_constrained'
  | 'large_model_consent_missing'
  | 'litert_unavailable'
  | 'settings_fast_mode';

export type AiStackUpgradeReason =
  | 'litert_available'
  | 'large_model_consented'
  | 'high_capability_device'
  | 'best_quality_mode'
  | 'healthy_latency_window';

export interface AiModelBinding {
  id: RouterModelId | CoordinatorModelId;
  runtime: AiRuntimeId;
  role: 'router' | 'coordinator';
  estimatedSizeGiB: number;
  loadPolicy: 'eager' | 'lazy' | 'background' | 'disabled';
  requiresExplicitConsent: boolean;
}

export interface AiStackConstraints {
  maxPromptTokens: number;
  maxOutputTokens: number;
  temperature: number;
  localOnly: boolean;
  structuredOutputRequired: true;
  allowBackgroundUpgrade: boolean;
  maxBackgroundDownloadGiB: number;
}

export interface AiStackProfile {
  tier: AiStackTier;
  runtime: AiRuntimeId;
  router: AiModelBinding;
  coordinator: AiModelBinding;
  fallbackCoordinator: AiModelBinding;
  constraints: AiStackConstraints;
  diagnostics: {
    selectedBy: 'deterministic_policy';
    reasons: AiStackUpgradeReason[];
    degradeReasons: AiStackDegradeReason[];
    capabilityTier: RuntimeCapability['tier'];
    browserFamily?: RuntimeCapability['browserFamily'];
    deviceMemoryGiB?: number | null;
    webgpu: boolean;
  };
}

export interface AiStackProfileOptions {
  settingsMode: RuntimeMode;
  allowLiteRt?: boolean;
  preferLiteRt?: boolean;
  allowBackgroundUpgrade?: boolean;
  userConsentedToLargeModels?: boolean;
  availableStorageGiB?: number | null;
  sustainedCoordinatorLatencyMs?: number | null;
  batterySaverEnabled?: boolean;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
}

export interface BackgroundUpgradeCandidate {
  fromTier: AiStackTier;
  toTier: AiStackTier;
  coordinator: AiModelBinding;
  reason: AiStackUpgradeReason;
  requiresConsent: boolean;
  canStartNow: boolean;
}

const SMOLLM2_1_7B_SIZE_GIB = 1.77;
const GEMMA4_E2B_SIZE_GIB = 2.58;
const GEMMA4_E4B_SIZE_GIB = 4.24;
const PHI4_MINI_SIZE_GIB = 3.91;
const FUNCTIONGEMMA_270M_SIZE_GIB = 0.35;

const DEFAULT_BACKGROUND_DOWNLOAD_LIMIT_GIB = 2;
const SAFE_STORAGE_HEADROOM_GIB = 1;
const LATENCY_DEGRADE_THRESHOLD_MS = 2_000;

function routerBinding(runtime: AiRuntimeId): AiModelBinding {
  if (runtime === 'litert') {
    return {
      id: 'functiongemma_270m',
      runtime,
      role: 'router',
      estimatedSizeGiB: FUNCTIONGEMMA_270M_SIZE_GIB,
      loadPolicy: 'eager',
      requiresExplicitConsent: false,
    };
  }

  return {
    id: 'deterministic_policy',
    runtime: 'deterministic',
    role: 'router',
    estimatedSizeGiB: 0,
    loadPolicy: 'disabled',
    requiresExplicitConsent: false,
  };
}

function coordinatorBinding(params: {
  id: CoordinatorModelId;
  runtime: AiRuntimeId;
  loadPolicy: AiModelBinding['loadPolicy'];
  requiresExplicitConsent?: boolean;
}): AiModelBinding {
  const estimatedSizeGiB = (() => {
    switch (params.id) {
      case 'smollm2_1_7b':
        return SMOLLM2_1_7B_SIZE_GIB;
      case 'gemma4_e2b':
        return GEMMA4_E2B_SIZE_GIB;
      case 'gemma4_e4b':
        return GEMMA4_E4B_SIZE_GIB;
      case 'phi4_mini':
        return PHI4_MINI_SIZE_GIB;
      case 'none':
        return 0;
    }
  })();

  return {
    id: params.id,
    runtime: params.id === 'none' ? 'deterministic' : params.runtime,
    role: 'coordinator',
    estimatedSizeGiB,
    loadPolicy: params.loadPolicy,
    requiresExplicitConsent:
      params.requiresExplicitConsent ?? estimatedSizeGiB > DEFAULT_BACKGROUND_DOWNLOAD_LIMIT_GIB,
  };
}

function hasEnoughStorageForModel(
  availableStorageGiB: number | null | undefined,
  modelSizeGiB: number,
): boolean {
  if (availableStorageGiB == null) return true;
  return availableStorageGiB >= modelSizeGiB + SAFE_STORAGE_HEADROOM_GIB;
}

function shouldDegradeForRuntimeHealth(options: AiStackProfileOptions): AiStackDegradeReason[] {
  const reasons: AiStackDegradeReason[] = [];
  if (options.batterySaverEnabled) reasons.push('battery_saver');
  if (options.thermalState === 'serious' || options.thermalState === 'critical') {
    reasons.push('thermal_pressure');
  }
  if (
    typeof options.sustainedCoordinatorLatencyMs === 'number'
    && options.sustainedCoordinatorLatencyMs > LATENCY_DEGRADE_THRESHOLD_MS
  ) {
    reasons.push('latency_regression');
  }
  if (options.settingsMode === 'fast') reasons.push('settings_fast_mode');
  return reasons;
}

function constraintsForTier(tier: AiStackTier, allowBackgroundUpgrade: boolean): AiStackConstraints {
  switch (tier) {
    case 'edge_premium':
      return {
        maxPromptTokens: 1_536,
        maxOutputTokens: 768,
        temperature: 0.1,
        localOnly: true,
        structuredOutputRequired: true,
        allowBackgroundUpgrade,
        maxBackgroundDownloadGiB: DEFAULT_BACKGROUND_DOWNLOAD_LIMIT_GIB,
      };
    case 'edge_strong':
      return {
        maxPromptTokens: 1_024,
        maxOutputTokens: 512,
        temperature: 0.15,
        localOnly: true,
        structuredOutputRequired: true,
        allowBackgroundUpgrade,
        maxBackgroundDownloadGiB: DEFAULT_BACKGROUND_DOWNLOAD_LIMIT_GIB,
      };
    case 'browser_default':
      return {
        maxPromptTokens: 768,
        maxOutputTokens: 384,
        temperature: 0.2,
        localOnly: true,
        structuredOutputRequired: true,
        allowBackgroundUpgrade,
        maxBackgroundDownloadGiB: DEFAULT_BACKGROUND_DOWNLOAD_LIMIT_GIB,
      };
    case 'baseline':
      return {
        maxPromptTokens: 256,
        maxOutputTokens: 128,
        temperature: 0,
        localOnly: true,
        structuredOutputRequired: true,
        allowBackgroundUpgrade: false,
        maxBackgroundDownloadGiB: 0,
      };
  }
}

function baseProfile(params: {
  tier: AiStackTier;
  runtime: AiRuntimeId;
  capability: RuntimeCapability;
  router: AiModelBinding;
  coordinator: AiModelBinding;
  fallbackCoordinator: AiModelBinding;
  options: AiStackProfileOptions;
  reasons?: AiStackUpgradeReason[];
  degradeReasons?: AiStackDegradeReason[];
}): AiStackProfile {
  const allowBackgroundUpgrade = params.options.allowBackgroundUpgrade !== false;
  return {
    tier: params.tier,
    runtime: params.runtime,
    router: params.router,
    coordinator: params.coordinator,
    fallbackCoordinator: params.fallbackCoordinator,
    constraints: constraintsForTier(params.tier, allowBackgroundUpgrade),
    diagnostics: {
      selectedBy: 'deterministic_policy',
      reasons: params.reasons ?? [],
      degradeReasons: params.degradeReasons ?? [],
      capabilityTier: params.capability.tier,
      browserFamily: params.capability.browserFamily,
      deviceMemoryGiB: params.capability.deviceMemoryGiB ?? null,
      webgpu: params.capability.webgpu,
    },
  };
}

export function selectAiStackProfile(
  capability: RuntimeCapability,
  options: AiStackProfileOptions,
): AiStackProfile {
  const healthDegradeReasons = shouldDegradeForRuntimeHealth(options);
  const hardDegradeReasons: AiStackDegradeReason[] = [...healthDegradeReasons];

  if (!capability.webgpu) hardDegradeReasons.push('no_webgpu');
  if (!capability.generationAllowed) hardDegradeReasons.push('generation_disabled');

  if (
    hardDegradeReasons.includes('no_webgpu')
    || hardDegradeReasons.includes('generation_disabled')
    || hardDegradeReasons.includes('battery_saver')
    || hardDegradeReasons.includes('thermal_pressure')
    || hardDegradeReasons.includes('settings_fast_mode')
  ) {
    return baseProfile({
      tier: 'baseline',
      runtime: 'deterministic',
      capability,
      router: routerBinding('deterministic'),
      coordinator: coordinatorBinding({ id: 'none', runtime: 'deterministic', loadPolicy: 'disabled' }),
      fallbackCoordinator: coordinatorBinding({ id: 'none', runtime: 'deterministic', loadPolicy: 'disabled' }),
      options,
      degradeReasons: hardDegradeReasons,
    });
  }

  const liteRtAllowed = options.allowLiteRt === true;
  const preferLiteRt = options.preferLiteRt === true;
  const largeModelsAllowed = options.userConsentedToLargeModels === true;

  if (liteRtAllowed && preferLiteRt && capability.tier === 'high') {
    if (
      largeModelsAllowed
      && hasEnoughStorageForModel(options.availableStorageGiB, GEMMA4_E4B_SIZE_GIB)
    ) {
      return baseProfile({
        tier: 'edge_premium',
        runtime: 'litert',
        capability,
        router: routerBinding('litert'),
        coordinator: coordinatorBinding({ id: 'gemma4_e4b', runtime: 'litert', loadPolicy: 'lazy' }),
        fallbackCoordinator: coordinatorBinding({ id: 'gemma4_e2b', runtime: 'litert', loadPolicy: 'background' }),
        options,
        reasons: ['litert_available', 'large_model_consented', 'high_capability_device'],
        degradeReasons: healthDegradeReasons,
      });
    }

    if (hasEnoughStorageForModel(options.availableStorageGiB, GEMMA4_E2B_SIZE_GIB)) {
      return baseProfile({
        tier: 'edge_strong',
        runtime: 'litert',
        capability,
        router: routerBinding('litert'),
        coordinator: coordinatorBinding({
          id: 'gemma4_e2b',
          runtime: 'litert',
          loadPolicy: largeModelsAllowed ? 'lazy' : 'background',
          requiresExplicitConsent: !largeModelsAllowed,
        }),
        fallbackCoordinator: coordinatorBinding({ id: 'smollm2_1_7b', runtime: 'webllm', loadPolicy: 'background' }),
        options,
        reasons: ['litert_available', 'high_capability_device'],
        degradeReasons: largeModelsAllowed ? healthDegradeReasons : [...healthDegradeReasons, 'large_model_consent_missing'],
      });
    }
  }

  if (liteRtAllowed && preferLiteRt && capability.tier === 'mid') {
    if (
      largeModelsAllowed
      && hasEnoughStorageForModel(options.availableStorageGiB, GEMMA4_E2B_SIZE_GIB)
    ) {
      return baseProfile({
        tier: 'edge_strong',
        runtime: 'litert',
        capability,
        router: routerBinding('litert'),
        coordinator: coordinatorBinding({ id: 'gemma4_e2b', runtime: 'litert', loadPolicy: 'lazy' }),
        fallbackCoordinator: coordinatorBinding({ id: 'smollm2_1_7b', runtime: 'webllm', loadPolicy: 'background' }),
        options,
        reasons: ['litert_available', 'large_model_consented'],
        degradeReasons: healthDegradeReasons,
      });
    }
  }

  const browserDegradeReasons: AiStackDegradeReason[] = [...healthDegradeReasons];
  if (preferLiteRt && !liteRtAllowed) browserDegradeReasons.push('litert_unavailable');
  if (!hasEnoughStorageForModel(options.availableStorageGiB, SMOLLM2_1_7B_SIZE_GIB)) {
    browserDegradeReasons.push('storage_constrained');
    return baseProfile({
      tier: 'baseline',
      runtime: 'deterministic',
      capability,
      router: routerBinding('deterministic'),
      coordinator: coordinatorBinding({ id: 'none', runtime: 'deterministic', loadPolicy: 'disabled' }),
      fallbackCoordinator: coordinatorBinding({ id: 'none', runtime: 'deterministic', loadPolicy: 'disabled' }),
      options,
      degradeReasons: browserDegradeReasons,
    });
  }

  return baseProfile({
    tier: 'browser_default',
    runtime: 'webllm',
    capability,
    router: routerBinding('deterministic'),
    coordinator: coordinatorBinding({ id: 'smollm2_1_7b', runtime: 'webllm', loadPolicy: 'lazy', requiresExplicitConsent: false }),
    fallbackCoordinator: coordinatorBinding({ id: 'none', runtime: 'deterministic', loadPolicy: 'disabled' }),
    options,
    reasons: capability.tier === 'high' ? ['high_capability_device'] : [],
    degradeReasons: browserDegradeReasons,
  });
}

export function getBackgroundUpgradeCandidate(
  current: AiStackProfile,
  capability: RuntimeCapability,
  options: AiStackProfileOptions,
): BackgroundUpgradeCandidate | null {
  if (options.allowBackgroundUpgrade === false) return null;
  if (!capability.webgpu || !capability.generationAllowed) return null;
  if (options.batterySaverEnabled || options.thermalState === 'serious' || options.thermalState === 'critical') {
    return null;
  }

  const healthyLatency =
    options.sustainedCoordinatorLatencyMs == null
    || options.sustainedCoordinatorLatencyMs <= LATENCY_DEGRADE_THRESHOLD_MS;
  if (!healthyLatency) return null;

  const liteRtAvailable = options.allowLiteRt === true;
  if (!liteRtAvailable) return null;

  if (current.tier === 'browser_default' && capability.tier !== 'low') {
    const canFitE2B = hasEnoughStorageForModel(options.availableStorageGiB, GEMMA4_E2B_SIZE_GIB);
    if (!canFitE2B) return null;
    return {
      fromTier: current.tier,
      toTier: 'edge_strong',
      coordinator: coordinatorBinding({
        id: 'gemma4_e2b',
        runtime: 'litert',
        loadPolicy: 'background',
        requiresExplicitConsent: options.userConsentedToLargeModels !== true,
      }),
      reason: options.userConsentedToLargeModels === true ? 'large_model_consented' : 'litert_available',
      requiresConsent: options.userConsentedToLargeModels !== true,
      canStartNow: options.userConsentedToLargeModels === true,
    };
  }

  if (current.tier === 'edge_strong' && capability.tier === 'high') {
    const canFitE4B = hasEnoughStorageForModel(options.availableStorageGiB, GEMMA4_E4B_SIZE_GIB);
    if (!canFitE4B) return null;
    return {
      fromTier: current.tier,
      toTier: 'edge_premium',
      coordinator: coordinatorBinding({
        id: 'gemma4_e4b',
        runtime: 'litert',
        loadPolicy: 'background',
        requiresExplicitConsent: options.userConsentedToLargeModels !== true,
      }),
      reason: 'best_quality_mode',
      requiresConsent: options.userConsentedToLargeModels !== true,
      canStartNow: options.userConsentedToLargeModels === true && options.settingsMode === 'best_quality',
    };
  }

  return null;
}

export function shouldDegradeAiStack(
  current: AiStackProfile,
  options: AiStackProfileOptions,
): AiStackDegradeReason | null {
  const reasons = shouldDegradeForRuntimeHealth(options);
  if (reasons.includes('thermal_pressure')) return 'thermal_pressure';
  if (reasons.includes('battery_saver')) return 'battery_saver';
  if (reasons.includes('latency_regression') && current.tier !== 'baseline') return 'latency_regression';
  if (options.settingsMode === 'fast' && current.tier !== 'baseline') return 'settings_fast_mode';
  return null;
}
