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
): Promise<DeepInterpolatorResult> {
  try {
    const result = provider === 'openai'
      ? await openAIConversationProvider.writeDeepInterpolator(request)
      : await geminiConversationProvider.writeDeepInterpolator(request);
    recordPremiumAiProviderSuccess(provider);
    return result;
  } catch (error) {
    recordPremiumAiProviderFailure(provider, error);
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
    return await invokePremiumProvider(provider, request);
  } catch (error) {
    if (!isPremiumAiProviderUnavailableError(error)) {
      throw error;
    }

    const fallbackProvider = resolveEffectivePremiumAiProvider(preferredProvider);
    if (!fallbackProvider || fallbackProvider === provider) {
      throw error;
    }
    return invokePremiumProvider(fallbackProvider, request);
  }
}
