import type { PremiumAiProviderName } from '../ai/premiumProviderHealth.js';
import {
  isPremiumAiProviderOperational,
  isPremiumAiProviderUnavailableError,
  recordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess,
} from '../ai/premiumProviderHealth.js';
import { env } from '../config/env.js';
import type { PremiumAiProviderPreference } from '../entitlements/resolveAiEntitlements.js';
import { resolveGeminiModel } from '../lib/googleGenAi.js';
import { resolveOpenAiModel } from '../lib/openAi.js';
import { recordWriterEnhancerSkip } from '../llm/writerDiagnostics.js';
import { reviewWithGeminiInterpolatorEnhancer } from './geminiInterpolatorEnhancer.js';
import {
  type InterpolatorEnhancerReviewInput,
  type InterpolatorEnhancerReviewResult,
} from './interpolatorEnhancerShared.js';
import { reviewWithOpenAiInterpolatorEnhancer } from './openAiInterpolatorEnhancer.js';

const ENHANCER_PROVIDER_ORDER: PremiumAiProviderName[] = ['gemini', 'openai'];

function enhancerProviderConfigured(provider: PremiumAiProviderName): boolean {
  return provider === 'openai'
    ? Boolean(env.OPENAI_API_KEY)
    : Boolean(env.GEMINI_API_KEY);
}

function enhancerProviderEnabled(provider: PremiumAiProviderName): boolean {
  if (provider === 'openai') {
    return Boolean(env.OPENAI_INTERPOLATOR_ENHANCER_ENABLED && env.OPENAI_API_KEY);
  }
  return Boolean(env.GEMINI_INTERPOLATOR_ENHANCER_ENABLED && env.GEMINI_API_KEY);
}

function availableEnhancerProviders(): PremiumAiProviderName[] {
  return ENHANCER_PROVIDER_ORDER.filter(
    (provider) => enhancerProviderEnabled(provider) && isPremiumAiProviderOperational(provider),
  );
}

function resolvePreferredEnhancerProvider(
  preferredProvider: PremiumAiProviderPreference = 'auto',
): PremiumAiProviderName | undefined {
  const availableProviders = availableEnhancerProviders();
  if (availableProviders.length === 0) return undefined;

  if (preferredProvider !== 'auto' && availableProviders.includes(preferredProvider)) {
    return preferredProvider;
  }

  if (availableProviders.includes(env.PREMIUM_AI_PROVIDER)) {
    return env.PREMIUM_AI_PROVIDER;
  }

  return availableProviders[0];
}

function resolveEnhancerSkipReason(): 'disabled' | 'unconfigured' | 'unavailable' {
  if (!ENHANCER_PROVIDER_ORDER.some((provider) => enhancerProviderConfigured(provider))) {
    return 'unconfigured';
  }
  if (!ENHANCER_PROVIDER_ORDER.some((provider) => enhancerProviderEnabled(provider))) {
    return 'disabled';
  }
  return 'unavailable';
}

export function resolveInterpolatorEnhancerModel(
  preferredProvider: PremiumAiProviderPreference = 'auto',
): string | null {
  const provider = resolvePreferredEnhancerProvider(preferredProvider)
    ?? (preferredProvider === 'openai' && enhancerProviderEnabled('openai')
      ? 'openai'
      : preferredProvider === 'gemini' && enhancerProviderEnabled('gemini')
        ? 'gemini'
        : enhancerProviderEnabled(env.PREMIUM_AI_PROVIDER)
          ? env.PREMIUM_AI_PROVIDER
          : ENHANCER_PROVIDER_ORDER.find((candidate) => enhancerProviderEnabled(candidate)));
  if (!provider) return null;

  return provider === 'openai'
    ? resolveOpenAiModel(env.OPENAI_INTERPOLATOR_ENHANCER_MODEL)
    : resolveGeminiModel('interpolator-enhancer', env.GEMINI_INTERPOLATOR_ENHANCER_MODEL);
}

function annotateEnhancerError(
  error: unknown,
  provider: PremiumAiProviderName,
  model: string,
): Error & { enhancerProvider: PremiumAiProviderName; enhancerModel: string } {
  const baseError = error instanceof Error ? error : new Error(String(error));
  return Object.assign(baseError, {
    enhancerProvider: provider,
    enhancerModel: model,
  });
}

async function invokeEnhancerProvider(
  provider: PremiumAiProviderName,
  params: InterpolatorEnhancerReviewInput,
): Promise<InterpolatorEnhancerReviewResult> {
  try {
    const review = provider === 'openai'
      ? await reviewWithOpenAiInterpolatorEnhancer(params)
      : await reviewWithGeminiInterpolatorEnhancer(params);
    recordPremiumAiProviderSuccess(provider);
    return { provider, model: review.model, decision: review.decision };
  } catch (error) {
    const attemptedGeminiModels = Array.isArray((error as { geminiAttemptedModels?: unknown })?.geminiAttemptedModels)
      ? ((error as { geminiAttemptedModels?: string[] }).geminiAttemptedModels ?? []).filter((model) => typeof model === 'string' && model.trim().length > 0)
      : [];
    const model = provider === 'openai'
      ? resolveOpenAiModel(env.OPENAI_INTERPOLATOR_ENHANCER_MODEL)
      : attemptedGeminiModels.at(-1)
        ?? resolveGeminiModel('interpolator-enhancer', env.GEMINI_INTERPOLATOR_ENHANCER_MODEL);
    const annotated = annotateEnhancerError(error, provider, model);
    recordPremiumAiProviderFailure(provider, annotated);
    throw annotated;
  }
}

export async function reviewInterpolatorWriter(
  params: InterpolatorEnhancerReviewInput,
  options?: {
    preferredProvider?: PremiumAiProviderPreference;
  },
): Promise<InterpolatorEnhancerReviewResult | null> {
  const preferredProvider = options?.preferredProvider ?? 'auto';
  const provider = resolvePreferredEnhancerProvider(preferredProvider);
  if (!provider) {
    recordWriterEnhancerSkip(resolveEnhancerSkipReason());
    return null;
  }

  try {
    return await invokeEnhancerProvider(provider, params);
  } catch (error) {
    if (!isPremiumAiProviderUnavailableError(error)) {
      throw error;
    }

    const fallbackProvider = resolvePreferredEnhancerProvider(preferredProvider);
    if (!fallbackProvider || fallbackProvider === provider) {
      throw error;
    }

    return invokeEnhancerProvider(fallbackProvider, params);
  }
}
