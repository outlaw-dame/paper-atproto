import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockCreateOpenAIClient = vi.hoisted(() => vi.fn());
const mockResolveOpenAiModel = vi.hoisted(() => vi.fn(() => 'gpt-5.4'));
const mockIsPremiumAiProviderOperational = vi.hoisted(() => vi.fn(() => true));
const mockRecordPremiumAiProviderFailure = vi.hoisted(() => vi.fn());
const mockRecordPremiumAiProviderSuccess = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  PREMIUM_AI_TIMEOUT_MS: 25_000,
  PREMIUM_AI_RETRY_ATTEMPTS: 2,
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/lib/openAi.js', () => ({
  createOpenAIClient: mockCreateOpenAIClient,
  resolveOpenAiModel: mockResolveOpenAiModel,
}));

vi.mock('../../server/src/ai/premiumProviderHealth.js', () => ({
  isPremiumAiProviderOperational: mockIsPremiumAiProviderOperational,
  recordPremiumAiProviderFailure: mockRecordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess: mockRecordPremiumAiProviderSuccess,
}));

import {
  ensurePremiumAiProviderReady,
  resetPremiumAiProviderReadinessForTests,
} from '../../server/src/ai/premiumProviderReadiness.js';

describe('ensurePremiumAiProviderReady', () => {
  beforeEach(() => {
    resetPremiumAiProviderReadinessForTests();
    mockCreate.mockReset();
    mockCreateOpenAIClient.mockReset();
    mockResolveOpenAiModel.mockClear();
    mockIsPremiumAiProviderOperational.mockReset();
    mockRecordPremiumAiProviderFailure.mockReset();
    mockRecordPremiumAiProviderSuccess.mockReset();
    mockIsPremiumAiProviderOperational.mockReturnValue(true);
    mockCreateOpenAIClient.mockReturnValue({
      responses: {
        create: mockCreate,
      },
    });
  });

  it('probes OpenAI generation once and caches a successful readiness result', async () => {
    mockCreate.mockResolvedValue({ id: 'resp_123', output_text: 'ok' });

    await ensurePremiumAiProviderReady('openai');
    await ensurePremiumAiProviderReady('openai');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockResolveOpenAiModel).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderSuccess).toHaveBeenCalledWith('openai');
  });

  it('records outage-level failures without throwing to the caller', async () => {
    const quotaError = Object.assign(new Error('quota exceeded'), {
      status: 429,
      code: 'insufficient_quota',
    });
    mockCreate.mockRejectedValue(quotaError);

    await expect(ensurePremiumAiProviderReady('openai')).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderFailure).toHaveBeenCalledWith('openai', quotaError);
  });
});
