import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordPremiumAiProviderFailure,
  resetPremiumAiProviderHealthForTests,
} from '../ai/premiumProviderHealth.js';

const envMock = vi.hoisted(() => ({
  PREMIUM_AI_ENABLED: true,
  PREMIUM_AI_PROVIDER: 'gemini' as const,
  PREMIUM_AI_DEFAULT_TIER: 'pro' as const,
  PREMIUM_AI_ALLOWLIST_DIDS: '',
  GEMINI_API_KEY: 'gemini-test-key',
  OPENAI_API_KEY: 'openai-test-key',
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

import {
  getAvailablePremiumAiProviders,
  resolveEffectivePremiumAiProvider,
  resolvePremiumAiEntitlements,
} from './resolveAiEntitlements.js';

describe('resolvePremiumAiEntitlements', () => {
  beforeEach(() => {
    resetPremiumAiProviderHealthForTests();
    envMock.PREMIUM_AI_ENABLED = true;
    envMock.PREMIUM_AI_PROVIDER = 'gemini';
    envMock.PREMIUM_AI_DEFAULT_TIER = 'pro';
    envMock.PREMIUM_AI_ALLOWLIST_DIDS = '';
    envMock.GEMINI_API_KEY = 'gemini-test-key';
    envMock.OPENAI_API_KEY = 'openai-test-key';
  });

  it('exposes both configured providers and honors an explicit openai preference', () => {
    expect(getAvailablePremiumAiProviders()).toEqual(['gemini', 'openai']);
    expect(resolveEffectivePremiumAiProvider('openai')).toBe('openai');

    const entitlements = resolvePremiumAiEntitlements('did:plc:test-user', 'openai');

    expect(entitlements.tier).toBe('pro');
    expect(entitlements.capabilities).toEqual(['deep_interpolator']);
    expect(entitlements.providerAvailable).toBe(true);
    expect(entitlements.availableProviders).toEqual(['gemini', 'openai']);
    expect(entitlements.provider).toBe('openai');
  });

  it('falls back to the available default provider when the requested provider is unavailable', () => {
    envMock.OPENAI_API_KEY = undefined;

    expect(getAvailablePremiumAiProviders()).toEqual(['gemini']);
    expect(resolveEffectivePremiumAiProvider('openai')).toBe('gemini');

    const entitlements = resolvePremiumAiEntitlements('did:plc:test-user', 'openai');

    expect(entitlements.providerAvailable).toBe(true);
    expect(entitlements.availableProviders).toEqual(['gemini']);
    expect(entitlements.provider).toBe('gemini');
  });

  it('suppresses providers that are temporarily unhealthy at runtime', () => {
    recordPremiumAiProviderFailure(
      'openai',
      Object.assign(new Error('quota exceeded'), { status: 429, code: 'insufficient_quota' }),
    );

    expect(getAvailablePremiumAiProviders()).toEqual(['gemini']);
    expect(resolveEffectivePremiumAiProvider('openai')).toBe('gemini');

    const entitlements = resolvePremiumAiEntitlements('did:plc:test-user', 'openai');

    expect(entitlements.providerAvailable).toBe(true);
    expect(entitlements.availableProviders).toEqual(['gemini']);
    expect(entitlements.provider).toBe('gemini');
  });

  it('reports no provider availability when premium AI is disabled', () => {
    envMock.PREMIUM_AI_ENABLED = false;

    const entitlements = resolvePremiumAiEntitlements('did:plc:test-user', 'gemini');

    expect(entitlements.capabilities).toEqual([]);
    expect(entitlements.providerAvailable).toBe(false);
    expect(entitlements.availableProviders).toEqual([]);
    expect(entitlements.provider).toBeUndefined();
  });
});
