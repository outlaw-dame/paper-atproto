export const INTERPOLATOR_WRITER_ROUTING_POLICY_VERSION = 1 as const;

export type InterpolatorWriterMode = 'normal' | 'descriptive_fallback' | 'minimal_fallback';

export type InterpolatorWriterExecutionClass =
  | 'deterministic_projection'
  | 'local_ollama'
  | 'browser_local'
  | 'device_edge_litert'
  | 'cloud_edge_workers_ai'
  | 'external_api_enhancer';

export type InterpolatorWriterProviderId =
  | 'deterministic_writer_fallback'
  | 'qwen3_4b_ollama'
  | 'gemma_writer_local_or_litert'
  | 'browser_writer_small'
  | 'cloudflare_workers_ai_writer'
  | 'gemini_writer'
  | 'openai_writer'
  | 'mistral_writer';

export type InterpolatorWriterPrivacyTier =
  | 'public_content'
  | 'user_visible_public_context'
  | 'private_user_context'
  | 'sensitive_local_only';

export type InterpolatorWriterPreference =
  | 'auto_hybrid'
  | 'prefer_local'
  | 'local_only'
  | 'prefer_cloud_edge'
  | 'prefer_best_quality';

export type InterpolatorWriterQualityTier = 'basic' | 'balanced' | 'high' | 'premium';

export type InterpolatorWriterReasonCode =
  | 'minimal_mode_uses_deterministic_projection'
  | 'descriptive_mode_requires_grounded_writer'
  | 'normal_mode_prefers_highest_valid_quality'
  | 'local_only_honored'
  | 'private_context_blocks_remote'
  | 'sensitive_context_blocks_remote'
  | 'media_confidence_blocks_writer'
  | 'media_confidence_requires_descriptive_mode'
  | 'local_qwen_available'
  | 'gemma_available_for_eval_or_litert'
  | 'browser_writer_available'
  | 'cloud_edge_available'
  | 'external_api_enhancer_available'
  | 'external_api_enhancer_not_allowed'
  | 'device_resource_constrained'
  | 'battery_or_thermal_blocks_heavy_local'
  | 'fallback_to_deterministic_projection'
  | 'no_remote_provider_allowed'
  | 'writer_quality_threshold_requires_enhancer';

export interface InterpolatorWriterDeviceState {
  webgpu: boolean;
  liteRt: boolean;
  deviceMemoryGiB: number | null;
  storageAvailableGiB: number | null;
  batterySaver: boolean;
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
}

export interface InterpolatorWriterProviderAvailability {
  localQwen: boolean;
  gemmaLocalOrLiteRt: boolean;
  browserSmallWriter: boolean;
  cloudflareWorkersAi: boolean;
  externalApiEnhancers: boolean;
}

export interface InterpolatorWriterRoutingInput {
  mode: InterpolatorWriterMode;
  preference: InterpolatorWriterPreference;
  privacyTier: InterpolatorWriterPrivacyTier;
  qualityTier: InterpolatorWriterQualityTier;
  mediaPrimary: boolean;
  mediaObservationConfidence: number | null;
  writerQualityBelowThreshold: boolean;
  device: InterpolatorWriterDeviceState;
  providers: InterpolatorWriterProviderAvailability;
}

export interface InterpolatorWriterRouteCandidate {
  executionClass: InterpolatorWriterExecutionClass;
  provider: InterpolatorWriterProviderId;
  qualityTier: InterpolatorWriterQualityTier;
  estimatedLocalSizeGiB: number;
  remote: boolean;
  requiresExplicitConsent: boolean;
  reasonCodes: InterpolatorWriterReasonCode[];
}

export interface InterpolatorWriterRoutePlan {
  schemaVersion: typeof INTERPOLATOR_WRITER_ROUTING_POLICY_VERSION;
  selected: InterpolatorWriterRouteCandidate;
  fallback: InterpolatorWriterRouteCandidate;
  allowedCandidates: InterpolatorWriterRouteCandidate[];
  blockedCandidates: Array<{
    provider: InterpolatorWriterProviderId;
    executionClass: InterpolatorWriterExecutionClass;
    reasonCode: InterpolatorWriterReasonCode;
  }>;
  reasonCodes: InterpolatorWriterReasonCode[];
  localOnlyHonored: boolean;
  shouldInvokeEnhancer: boolean;
}

const DETERMINISTIC_FALLBACK: InterpolatorWriterRouteCandidate = {
  executionClass: 'deterministic_projection',
  provider: 'deterministic_writer_fallback',
  qualityTier: 'basic',
  estimatedLocalSizeGiB: 0,
  remote: false,
  requiresExplicitConsent: false,
  reasonCodes: ['fallback_to_deterministic_projection'],
};

export function selectInterpolatorWriterRoute(input: InterpolatorWriterRoutingInput): InterpolatorWriterRoutePlan {
  const normalizedMediaConfidence = normalizeOptionalConfidence(input.mediaObservationConfidence);
  const blockedCandidates: InterpolatorWriterRoutePlan['blockedCandidates'] = [];
  const globalReasonCodes: InterpolatorWriterReasonCode[] = [];

  if (input.mode === 'minimal_fallback') {
    return buildPlan({
      selected: {
        ...DETERMINISTIC_FALLBACK,
        reasonCodes: ['minimal_mode_uses_deterministic_projection'],
      },
      allowedCandidates: [DETERMINISTIC_FALLBACK],
      blockedCandidates,
      reasonCodes: ['minimal_mode_uses_deterministic_projection'],
      localOnlyHonored: input.preference === 'local_only',
      shouldInvokeEnhancer: false,
    });
  }

  if (input.mediaPrimary && normalizedMediaConfidence !== null && normalizedMediaConfidence < 0.5) {
    return buildPlan({
      selected: {
        ...DETERMINISTIC_FALLBACK,
        reasonCodes: ['media_confidence_blocks_writer'],
      },
      allowedCandidates: [DETERMINISTIC_FALLBACK],
      blockedCandidates,
      reasonCodes: ['media_confidence_blocks_writer'],
      localOnlyHonored: input.preference === 'local_only',
      shouldInvokeEnhancer: false,
    });
  }

  if (input.mediaPrimary && normalizedMediaConfidence !== null && normalizedMediaConfidence < 0.7) {
    globalReasonCodes.push('media_confidence_requires_descriptive_mode');
  }

  const candidates = buildCandidates(input);
  const allowedCandidates = candidates.filter((candidate) => {
    const blockedReason = getBlockedReason(candidate, input);
    if (blockedReason) {
      blockedCandidates.push({
        provider: candidate.provider,
        executionClass: candidate.executionClass,
        reasonCode: blockedReason,
      });
      return false;
    }
    return true;
  });

  // DETERMINISTIC_FALLBACK is always present in candidates and cannot be blocked.
  const selected = rankCandidates(allowedCandidates, input)[0]!;
  const shouldInvokeEnhancer = input.writerQualityBelowThreshold && canInvokeEnhancer(input, allowedCandidates);
  const reasonCodes = unique([
    ...globalReasonCodes,
    ...(input.mode === 'descriptive_fallback' ? ['descriptive_mode_requires_grounded_writer' as const] : ['normal_mode_prefers_highest_valid_quality' as const]),
    ...selected.reasonCodes,
    ...(input.preference === 'local_only' ? ['local_only_honored' as const] : []),
    ...(shouldInvokeEnhancer ? ['writer_quality_threshold_requires_enhancer' as const] : []),
  ]);

  return buildPlan({
    selected,
    allowedCandidates,
    blockedCandidates,
    reasonCodes,
    localOnlyHonored: input.preference === 'local_only' && !selected.remote,
    shouldInvokeEnhancer,
  });
}

function buildCandidates(input: InterpolatorWriterRoutingInput): InterpolatorWriterRouteCandidate[] {
  const candidates: InterpolatorWriterRouteCandidate[] = [DETERMINISTIC_FALLBACK];

  if (input.providers.localQwen) {
    candidates.push({
      executionClass: 'local_ollama',
      provider: 'qwen3_4b_ollama',
      qualityTier: 'high',
      estimatedLocalSizeGiB: 2.6,
      remote: false,
      requiresExplicitConsent: false,
      reasonCodes: ['local_qwen_available'],
    });
  }

  if (input.providers.gemmaLocalOrLiteRt) {
    candidates.push({
      executionClass: input.device.liteRt ? 'device_edge_litert' : 'local_ollama',
      provider: 'gemma_writer_local_or_litert',
      qualityTier: 'high',
      estimatedLocalSizeGiB: 2.6,
      remote: false,
      requiresExplicitConsent: false,
      reasonCodes: ['gemma_available_for_eval_or_litert'],
    });
  }

  if (input.providers.browserSmallWriter) {
    candidates.push({
      executionClass: 'browser_local',
      provider: 'browser_writer_small',
      qualityTier: 'balanced',
      estimatedLocalSizeGiB: 1.5,
      remote: false,
      requiresExplicitConsent: false,
      reasonCodes: ['browser_writer_available'],
    });
  }

  if (input.providers.cloudflareWorkersAi) {
    candidates.push({
      executionClass: 'cloud_edge_workers_ai',
      provider: 'cloudflare_workers_ai_writer',
      qualityTier: 'high',
      estimatedLocalSizeGiB: 0,
      remote: true,
      requiresExplicitConsent: false,
      reasonCodes: ['cloud_edge_available'],
    });
  }

  if (input.providers.externalApiEnhancers) {
    candidates.push({
      executionClass: 'external_api_enhancer',
      provider: preferredExternalApiProvider(input),
      qualityTier: 'premium',
      estimatedLocalSizeGiB: 0,
      remote: true,
      requiresExplicitConsent: true,
      reasonCodes: ['external_api_enhancer_available'],
    });
  }

  return candidates;
}

function getBlockedReason(
  candidate: InterpolatorWriterRouteCandidate,
  input: InterpolatorWriterRoutingInput,
): InterpolatorWriterReasonCode | null {
  if (candidate.remote && input.preference === 'local_only') return 'no_remote_provider_allowed';
  if (candidate.remote && input.privacyTier === 'private_user_context') return 'private_context_blocks_remote';
  if (candidate.remote && input.privacyTier === 'sensitive_local_only') return 'sensitive_context_blocks_remote';
  if (candidate.executionClass === 'external_api_enhancer' && input.preference !== 'prefer_best_quality' && !input.writerQualityBelowThreshold) {
    return 'external_api_enhancer_not_allowed';
  }
  if (!candidate.remote && candidate.estimatedLocalSizeGiB > 0) {
    if (input.device.batterySaver || input.device.thermalState === 'serious' || input.device.thermalState === 'critical') {
      return 'battery_or_thermal_blocks_heavy_local';
    }
    if (!hasEnoughLocalResources(candidate, input.device)) return 'device_resource_constrained';
  }
  return null;
}

function hasEnoughLocalResources(candidate: InterpolatorWriterRouteCandidate, device: InterpolatorWriterDeviceState): boolean {
  const memory = device.deviceMemoryGiB;
  const storage = device.storageAvailableGiB;
  if (memory !== null && memory < Math.max(3.5, candidate.estimatedLocalSizeGiB * 1.5)) return false;
  if (storage !== null && storage < candidate.estimatedLocalSizeGiB + 1) return false;
  if (candidate.executionClass === 'browser_local' && !device.webgpu) return false;
  if (candidate.executionClass === 'device_edge_litert' && !device.liteRt) return false;
  return true;
}

function rankCandidates(
  candidates: readonly InterpolatorWriterRouteCandidate[],
  input: InterpolatorWriterRoutingInput,
): InterpolatorWriterRouteCandidate[] {
  return [...candidates].sort((a, b) => scoreCandidate(b, input) - scoreCandidate(a, input));
}

function scoreCandidate(candidate: InterpolatorWriterRouteCandidate, input: InterpolatorWriterRoutingInput): number {
  let score = qualityScore(candidate.qualityTier);

  if (candidate.provider === 'deterministic_writer_fallback') score -= input.mode === 'descriptive_fallback' ? 1 : 3;
  if (input.preference === 'prefer_local' && !candidate.remote) score += 3;
  if (input.preference === 'local_only' && !candidate.remote) score += 5;
  if (input.preference === 'prefer_cloud_edge' && candidate.executionClass === 'cloud_edge_workers_ai') score += 4;
  if (input.preference === 'prefer_best_quality' && candidate.executionClass === 'external_api_enhancer') score += 5;
  if (input.writerQualityBelowThreshold && candidate.executionClass === 'external_api_enhancer') score += 6;
  if (input.mode === 'descriptive_fallback' && candidate.remote) score -= 1;
  if (input.mediaPrimary && candidate.executionClass === 'external_api_enhancer') score += 2;
  if (candidate.executionClass === 'browser_local') score -= 1;

  return score;
}

function qualityScore(tier: InterpolatorWriterQualityTier): number {
  switch (tier) {
    case 'premium':
      return 40;
    case 'high':
      return 30;
    case 'balanced':
      return 20;
    case 'basic':
      return 10;
  }
}

function preferredExternalApiProvider(input: InterpolatorWriterRoutingInput): InterpolatorWriterProviderId {
  if (input.mediaPrimary) return 'gemini_writer';
  if (input.qualityTier === 'premium') return 'openai_writer';
  return 'mistral_writer';
}

function canInvokeEnhancer(
  input: InterpolatorWriterRoutingInput,
  allowedCandidates: readonly InterpolatorWriterRouteCandidate[],
): boolean {
  if (!input.providers.externalApiEnhancers) return false;
  if (input.preference === 'local_only') return false;
  if (input.privacyTier === 'private_user_context' || input.privacyTier === 'sensitive_local_only') return false;
  return allowedCandidates.some((candidate) => candidate.executionClass === 'external_api_enhancer');
}

function normalizeOptionalConfidence(confidence: number | null): number | null {
  if (confidence === null) return null;
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function buildPlan(params: {
  selected: InterpolatorWriterRouteCandidate;
  allowedCandidates: InterpolatorWriterRouteCandidate[];
  blockedCandidates: InterpolatorWriterRoutePlan['blockedCandidates'];
  reasonCodes: InterpolatorWriterReasonCode[];
  localOnlyHonored: boolean;
  shouldInvokeEnhancer: boolean;
}): InterpolatorWriterRoutePlan {
  return {
    schemaVersion: INTERPOLATOR_WRITER_ROUTING_POLICY_VERSION,
    selected: params.selected,
    fallback: DETERMINISTIC_FALLBACK,
    allowedCandidates: params.allowedCandidates,
    blockedCandidates: params.blockedCandidates,
    reasonCodes: unique(params.reasonCodes),
    localOnlyHonored: params.localOnlyHonored,
    shouldInvokeEnhancer: params.shouldInvokeEnhancer,
  };
}

export function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
