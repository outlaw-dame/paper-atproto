import { isPremiumAiProviderOperational } from '../ai/premiumProviderHealth.js';
import { env } from '../config/env.js';

export type PremiumAiTier = 'free' | 'plus' | 'pro';
export type PremiumAiCapability = 'deep_interpolator' | 'explore_insight';
export type PremiumAiProvider = 'gemini' | 'openai';
export type PremiumAiProviderPreference = PremiumAiProvider | 'auto';

export interface PremiumAiEntitlements {
  tier: PremiumAiTier;
  capabilities: PremiumAiCapability[];
  providerAvailable: boolean;
  availableProviders: PremiumAiProvider[];
  provider?: PremiumAiProvider;
}

const CAPABILITIES_BY_TIER: Record<PremiumAiTier, PremiumAiCapability[]> = {
  free: [],
  plus: ['deep_interpolator', 'explore_insight'],
  pro: ['deep_interpolator', 'explore_insight'],
};

const PREMIUM_AI_PROVIDER_ORDER: PremiumAiProvider[] = ['gemini', 'openai'];

function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function providerConfigured(provider: PremiumAiProvider): boolean {
  if (!env.PREMIUM_AI_ENABLED) return false;
  return provider === 'openai'
    ? Boolean(env.OPENAI_API_KEY)
    : Boolean(env.GEMINI_API_KEY);
}

export function getAvailablePremiumAiProviders(): PremiumAiProvider[] {
  return PREMIUM_AI_PROVIDER_ORDER.filter(
    (provider) => providerConfigured(provider) && isPremiumAiProviderOperational(provider),
  );
}

export function resolveEffectivePremiumAiProvider(
  preferredProvider: PremiumAiProviderPreference = 'auto',
): PremiumAiProvider | undefined {
  const availableProviders = getAvailablePremiumAiProviders();
  if (availableProviders.length === 0) return undefined;

  if (preferredProvider !== 'auto' && availableProviders.includes(preferredProvider)) {
    return preferredProvider;
  }

  if (availableProviders.includes(env.PREMIUM_AI_PROVIDER)) {
    return env.PREMIUM_AI_PROVIDER;
  }

  return availableProviders[0];
}

export function resolvePremiumAiEntitlements(
  actorDid?: string,
  preferredProvider: PremiumAiProviderPreference = 'auto',
): PremiumAiEntitlements {
  const availableProviders = getAvailablePremiumAiProviders();
  const provider = resolveEffectivePremiumAiProvider(preferredProvider);
  const providerAvailable = availableProviders.length > 0;
  const normalizedDid = actorDid?.trim();
  const allowlist = parseAllowlist(env.PREMIUM_AI_ALLOWLIST_DIDS);

  let tier: PremiumAiTier = 'free';
  if (env.PREMIUM_AI_DEFAULT_TIER !== 'free') {
    tier = env.PREMIUM_AI_DEFAULT_TIER;
  } else if (normalizedDid && allowlist.has(normalizedDid)) {
    tier = 'pro';
  }

  const capabilities = providerAvailable ? CAPABILITIES_BY_TIER[tier] : [];

  return {
    tier,
    capabilities,
    providerAvailable,
    availableProviders,
    ...(provider ? { provider } : {}),
  };
}
