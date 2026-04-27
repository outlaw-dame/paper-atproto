import { describe, expect, it } from 'vitest';
import {
  selectInterpolatorWriterRoute,
  type InterpolatorWriterRoutingInput,
} from './interpolatorWriterRoutingPolicy';

function input(overrides: Partial<InterpolatorWriterRoutingInput> = {}): InterpolatorWriterRoutingInput {
  return {
    mode: 'normal',
    preference: 'auto_hybrid',
    privacyTier: 'public_content',
    qualityTier: 'high',
    mediaPrimary: false,
    mediaObservationConfidence: null,
    writerQualityBelowThreshold: false,
    device: {
      webgpu: true,
      liteRt: true,
      deviceMemoryGiB: 8,
      storageAvailableGiB: 16,
      batterySaver: false,
      thermalState: 'nominal',
    },
    providers: {
      localQwen: true,
      gemmaLocalOrLiteRt: true,
      browserSmallWriter: true,
      cloudflareWorkersAi: true,
      externalApiEnhancers: true,
    },
    ...overrides,
  };
}

describe('interpolator writer routing policy', () => {
  it('uses deterministic projection for minimal fallback mode', () => {
    const plan = selectInterpolatorWriterRoute(input({ mode: 'minimal_fallback' }));

    expect(plan.selected.provider).toBe('deterministic_writer_fallback');
    expect(plan.reasonCodes).toContain('minimal_mode_uses_deterministic_projection');
    expect(plan.shouldInvokeEnhancer).toBe(false);
  });

  it('blocks the writer when primary media confidence is too low', () => {
    const plan = selectInterpolatorWriterRoute(input({
      mediaPrimary: true,
      mediaObservationConfidence: 0.31,
    }));

    expect(plan.selected.provider).toBe('deterministic_writer_fallback');
    expect(plan.reasonCodes).toContain('media_confidence_blocks_writer');
  });

  it('keeps remote providers out of local-only writer plans', () => {
    const plan = selectInterpolatorWriterRoute(input({ preference: 'local_only' }));

    expect(plan.selected.remote).toBe(false);
    expect(plan.localOnlyHonored).toBe(true);
    expect(plan.allowedCandidates.every((candidate) => !candidate.remote)).toBe(true);
    expect(plan.blockedCandidates.map((candidate) => candidate.reasonCode)).toContain('no_remote_provider_allowed');
  });

  it('blocks remote providers for private context even outside local-only mode', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_cloud_edge',
      privacyTier: 'private_user_context',
    }));

    expect(plan.selected.remote).toBe(false);
    expect(plan.blockedCandidates.map((candidate) => candidate.reasonCode)).toContain('private_context_blocks_remote');
  });

  it('selects a local high-quality writer when local resources are healthy', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_local',
      providers: {
        localQwen: true,
        gemmaLocalOrLiteRt: false,
        browserSmallWriter: true,
        cloudflareWorkersAi: true,
        externalApiEnhancers: false,
      },
    }));

    expect(plan.selected.provider).toBe('qwen3_4b_ollama');
    expect(plan.reasonCodes).toContain('local_qwen_available');
  });

  it('can select Gemma local/LiteRT writer as a first-class candidate', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_local',
      providers: {
        localQwen: false,
        gemmaLocalOrLiteRt: true,
        browserSmallWriter: true,
        cloudflareWorkersAi: true,
        externalApiEnhancers: false,
      },
    }));

    expect(plan.selected.provider).toBe('gemma_writer_local_or_litert');
    expect(plan.selected.executionClass).toBe('device_edge_litert');
    expect(plan.reasonCodes).toContain('gemma_available_for_eval_or_litert');
  });

  it('routes public long-form writing to Cloudflare edge when preferred and available', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_cloud_edge',
      providers: {
        localQwen: true,
        gemmaLocalOrLiteRt: true,
        browserSmallWriter: true,
        cloudflareWorkersAi: true,
        externalApiEnhancers: false,
      },
    }));

    expect(plan.selected.provider).toBe('cloudflare_workers_ai_writer');
    expect(plan.reasonCodes).toContain('cloud_edge_available');
  });

  it('does not select API enhancer unless best-quality is requested or writer quality fails', () => {
    const normalPlan = selectInterpolatorWriterRoute(input({
      preference: 'auto_hybrid',
      writerQualityBelowThreshold: false,
    }));
    expect(normalPlan.selected.executionClass).not.toBe('external_api_enhancer');
    expect(normalPlan.blockedCandidates.map((candidate) => candidate.reasonCode)).toContain('external_api_enhancer_not_allowed');

    const failedQualityPlan = selectInterpolatorWriterRoute(input({
      preference: 'auto_hybrid',
      writerQualityBelowThreshold: true,
    }));
    expect(failedQualityPlan.selected.executionClass).toBe('external_api_enhancer');
    expect(failedQualityPlan.shouldInvokeEnhancer).toBe(true);
    expect(failedQualityPlan.reasonCodes).toContain('writer_quality_threshold_requires_enhancer');
  });

  it('uses an API writer for best-quality public writing when allowed', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_best_quality',
      qualityTier: 'premium',
      mediaPrimary: false,
    }));

    expect(plan.selected.provider).toBe('openai_writer');
    expect(plan.selected.executionClass).toBe('external_api_enhancer');
  });

  it('prefers Gemini for media-primary API writer enhancement when allowed', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_best_quality',
      mediaPrimary: true,
      mediaObservationConfidence: 0.92,
    }));

    expect(plan.selected.provider).toBe('gemini_writer');
    expect(plan.selected.executionClass).toBe('external_api_enhancer');
  });

  it('blocks heavy local writers when battery or thermal state is constrained', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'prefer_local',
      device: {
        webgpu: true,
        liteRt: true,
        deviceMemoryGiB: 8,
        storageAvailableGiB: 16,
        batterySaver: true,
        thermalState: 'nominal',
      },
      providers: {
        localQwen: true,
        gemmaLocalOrLiteRt: true,
        browserSmallWriter: false,
        cloudflareWorkersAi: true,
        externalApiEnhancers: false,
      },
    }));

    expect(plan.selected.provider).toBe('cloudflare_workers_ai_writer');
    expect(plan.blockedCandidates.map((candidate) => candidate.reasonCode)).toContain('battery_or_thermal_blocks_heavy_local');
  });

  it('falls back deterministically when every non-deterministic provider is unavailable or blocked', () => {
    const plan = selectInterpolatorWriterRoute(input({
      preference: 'local_only',
      providers: {
        localQwen: false,
        gemmaLocalOrLiteRt: false,
        browserSmallWriter: false,
        cloudflareWorkersAi: true,
        externalApiEnhancers: true,
      },
    }));

    expect(plan.selected.provider).toBe('deterministic_writer_fallback');
    expect(plan.allowedCandidates).toHaveLength(1);
    expect(plan.reasonCodes).toContain('fallback_to_deterministic_projection');
  });
});
