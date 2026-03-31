import { env } from '../config/env.js';

export type PremiumAiTier = 'free' | 'plus' | 'pro';
export type PremiumAiCapability = 'deep_interpolator';

export interface PremiumAiEntitlements {
  tier: PremiumAiTier;
  capabilities: PremiumAiCapability[];
  providerAvailable: boolean;
  provider?: 'gemini';
}

const CAPABILITIES_BY_TIER: Record<PremiumAiTier, PremiumAiCapability[]> = {
  free: [],
  plus: ['deep_interpolator'],
  pro: ['deep_interpolator'],
};

function parseAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function resolvePremiumAiEntitlements(
  actorDid?: string,
): PremiumAiEntitlements {
  const providerAvailable = Boolean(env.PREMIUM_AI_ENABLED && env.GEMINI_API_KEY);
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
    ...(providerAvailable ? { provider: 'gemini' as const } : {}),
  };
}
