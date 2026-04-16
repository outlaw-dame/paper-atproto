import {
  resolveEffectivePremiumAiProvider,
  type PremiumAiProviderPreference,
} from '../entitlements/resolveAiEntitlements.js';
import {
  isPremiumAiProviderUnavailableError,
  recordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess,
  type PremiumAiProviderName,
} from './premiumProviderHealth.js';
import {
  recordPremiumProviderAttempt,
  recordPremiumProviderFailure,
  recordPremiumProviderFailover,
  recordPremiumProviderSuccess,
} from '../llm/premiumDiagnostics.js';
import {
  GeminiConversationProvider,
  type DeepInterpolatorResult,
  type PremiumInterpolatorRequest,
} from './providers/geminiConversation.provider.js';
import { OpenAIConversationProvider } from './providers/openAiConversation.provider.js';

const geminiConversationProvider = new GeminiConversationProvider();
const openAIConversationProvider = new OpenAIConversationProvider();

async function invokePremiumProvider(
  provider: PremiumAiProviderName,
  request: PremiumInterpolatorRequest,
  attemptKind: 'primary' | 'fallback',
  requestId?: string,
): Promise<DeepInterpolatorResult> {
  const startedAt = Date.now();
  recordPremiumProviderAttempt({ provider, attemptKind });
  try {
    const result = provider === 'openai'
      ? await openAIConversationProvider.writeDeepInterpolator(request)
      : await geminiConversationProvider.writeDeepInterpolator(request);
    recordPremiumAiProviderSuccess(provider);
    recordPremiumProviderSuccess({
      provider,
      attemptKind,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    if (error && typeof error === 'object') {
      Object.assign(error as object, {
        premiumProvider: provider,
        premiumAttemptKind: attemptKind,
      });
    }
    recordPremiumAiProviderFailure(provider, error);
    recordPremiumProviderFailure({
      provider,
      attemptKind,
      latencyMs: Date.now() - startedAt,
      error,
      ...(requestId ? { requestId } : {}),
    });
    throw error;
  }
}

export async function writePremiumDeepInterpolator(
  request: PremiumInterpolatorRequest,
  options?: {
    preferredProvider?: PremiumAiProviderPreference;
  },
): Promise<DeepInterpolatorResult> {
  const preferredProvider = options?.preferredProvider ?? 'auto';
  const provider = resolveEffectivePremiumAiProvider(preferredProvider);
  if (!provider) {
    throw Object.assign(new Error('No premium AI provider is configured'), { status: 503 });
  }

  try {
    return await invokePremiumProvider(provider, request, 'primary', request.requestId);
  } catch (error) {
    if (!isPremiumAiProviderUnavailableError(error)) {
      throw error;
    }

    const fallbackProvider = resolveEffectivePremiumAiProvider(preferredProvider);
    if (!fallbackProvider || fallbackProvider === provider) {
      throw error;
    }
    recordPremiumProviderFailover({
      fromProvider: provider,
      toProvider: fallbackProvider,
    });
    return invokePremiumProvider(fallbackProvider, request, 'fallback', request.requestId);
  }
}
