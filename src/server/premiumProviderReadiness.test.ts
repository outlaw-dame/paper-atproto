import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockGeminiGenerate = vi.hoisted(() => vi.fn());
const mockCreateOpenAIClient = vi.hoisted(() => vi.fn());
const mockCreateGoogleGenAIClient = vi.hoisted(() => vi.fn());
const mockResolveOpenAiModel = vi.hoisted(() => vi.fn(() => 'gpt-5.4'));
const mockResolveGeminiModel = vi.hoisted(() => vi.fn(() => 'gemini-3-flash-preview'));
const mockResolveGeminiModelFallbackChain = vi.hoisted(() => vi.fn(() => ['gemini-3-flash-preview', 'gemini-2.5-flash']));
const mockGeminiThinkingConfig = vi.hoisted(() => vi.fn(() => ({
  thinkingConfig: { thinkingLevel: 'MINIMAL' },
})));
const mockIsGemini3Model = vi.hoisted(() => vi.fn(() => true));
const mockIsPremiumAiProviderOperational = vi.hoisted(() => vi.fn(() => true));
const mockRecordPremiumAiProviderFailure = vi.hoisted(() => vi.fn());
const mockRecordPremiumAiProviderSuccess = vi.hoisted(() => vi.fn());

const envMock = vi.hoisted(() => ({
  PREMIUM_AI_TIMEOUT_MS: 25_000,
  PREMIUM_AI_RETRY_ATTEMPTS: 2,
  GEMINI_DEEP_INTERPOLATOR_MODEL: 'gemini-3-flash-preview',
  GEMINI_DEEP_INTERPOLATOR_FALLBACK_MODELS: 'gemini-2.5-flash',
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/lib/openAi.js', () => ({
  createOpenAIClient: mockCreateOpenAIClient,
  resolveOpenAiModel: mockResolveOpenAiModel,
}));

vi.mock('../../server/src/lib/googleGenAi.js', () => ({
  createGoogleGenAIClient: mockCreateGoogleGenAIClient,
  geminiThinkingConfig: mockGeminiThinkingConfig,
  isGeminiModelFallbackEligibleError: (error: unknown) => {
    const status = (error as { status?: number })?.status;
    return typeof status === 'number' && [400, 401, 403, 404, 408, 425, 429, 500, 502, 503, 504].includes(status);
  },
  isGemini3Model: mockIsGemini3Model,
  resolveGeminiModel: mockResolveGeminiModel,
  resolveGeminiModelFallbackChain: mockResolveGeminiModelFallbackChain,
  withGeminiModelFallback: async <T,>(
    models: string[],
    runner: (model: string) => Promise<T>,
    shouldFallback: (error: unknown, context: { model: string; attempt: number; nextModel: string | null; attemptedModels: string[] }) => boolean,
  ) => {
    const attemptedModels: string[] = [];
    for (let attempt = 0; attempt < models.length; attempt += 1) {
      const model = models[attempt]!;
      attemptedModels.push(model);
      try {
        return { model, value: await runner(model) };
      } catch (error) {
        const nextModel = models[attempt + 1] ?? null;
        if (!nextModel || !shouldFallback(error, { model, attempt, nextModel, attemptedModels: [...attemptedModels] })) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            geminiAttemptedModels: [...attemptedModels],
            geminiFallbackExhausted: nextModel === null,
          });
        }
      }
    }
    throw new Error('Gemini model fallback chain exhausted');
  },
}));

vi.mock('../../server/src/ai/premiumProviderHealth.js', () => ({
  classifyPremiumAiProviderOutage: (error: unknown) => {
    const code = (error as { code?: string })?.code;
    const status = (error as { status?: number })?.status;
    if (code === 'deep_interpolator_non_additive_output' || code === 'deep_interpolator_low_signal_output') {
      return 'quality_unavailable';
    }
    if (code === 'insufficient_quota') return 'insufficient_quota';
    if (code === 'model_not_found' || status === 404) return 'model_unavailable';
    if (status === 429) return 'rate_limited';
    if (status === 504) return 'timeout';
    if (status === 503) return 'provider_unavailable';
    return null;
  },
  isPremiumAiProviderOperational: mockIsPremiumAiProviderOperational,
  isPremiumAiProviderUnavailableError: (error: unknown) => {
    const code = (error as { code?: string })?.code;
    const status = (error as { status?: number })?.status;
    return (
      code === 'insufficient_quota'
      || code === 'deep_interpolator_non_additive_output'
      || typeof status === 'number' && [408, 429, 500, 502, 503, 504].includes(status)
    );
  },
  isPersistentPremiumAiProviderOutageReason: (reason: string | null | undefined) => (
    reason === 'insufficient_quota' || reason === 'auth_unavailable' || reason === 'model_unavailable'
  ),
  recordPremiumAiProviderFailure: mockRecordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess: mockRecordPremiumAiProviderSuccess,
}));

let readinessModule: typeof import('../../server/src/ai/premiumProviderReadiness.js');

describe('ensurePremiumAiProviderReady', () => {
  beforeEach(async () => {
    readinessModule = await import(`../../server/src/ai/premiumProviderReadiness.js?test=${Date.now()}`);
    readinessModule.resetPremiumAiProviderReadinessForTests();
    mockCreate.mockReset();
    mockGeminiGenerate.mockReset();
    mockCreateOpenAIClient.mockReset();
    mockCreateGoogleGenAIClient.mockReset();
    mockResolveOpenAiModel.mockClear();
    mockResolveGeminiModel.mockClear();
    mockResolveGeminiModelFallbackChain.mockClear();
    mockGeminiThinkingConfig.mockClear();
    mockIsGemini3Model.mockClear();
    mockIsPremiumAiProviderOperational.mockReset();
    mockRecordPremiumAiProviderFailure.mockReset();
    mockRecordPremiumAiProviderSuccess.mockReset();
    mockIsPremiumAiProviderOperational.mockReturnValue(true);
    mockCreateOpenAIClient.mockReturnValue({
      responses: {
        create: mockCreate,
      },
    });
    mockCreateGoogleGenAIClient.mockReturnValue({
      models: {
        generateContent: mockGeminiGenerate,
      },
    });
  });

  it('probes OpenAI generation once and caches a successful readiness result', async () => {
    mockCreate.mockResolvedValue({ id: 'resp_123', output_text: 'ok' });

    await readinessModule.ensurePremiumAiProviderReady('openai');
    await readinessModule.ensurePremiumAiProviderReady('openai');

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

    await expect(readinessModule.ensurePremiumAiProviderReady('openai')).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderFailure).toHaveBeenCalledWith('openai', quotaError);
  });

  it('does not suppress Gemini on transient readiness probe failures', async () => {
    const timeoutError = Object.assign(new Error('temporary timeout'), {
      status: 504,
      code: 'deadline_exceeded',
    });
    mockGeminiGenerate.mockRejectedValue(timeoutError);

    await expect(readinessModule.ensurePremiumAiProviderReady('gemini')).resolves.toBeUndefined();

    expect(mockGeminiGenerate).toHaveBeenCalledTimes(4);
    expect(mockGeminiGenerate.mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-3-flash-preview' });
    expect(mockGeminiGenerate.mock.calls[2]?.[0]).toMatchObject({ model: 'gemini-2.5-flash' });
    expect(mockRecordPremiumAiProviderFailure).not.toHaveBeenCalled();
    expect(mockRecordPremiumAiProviderSuccess).not.toHaveBeenCalledWith('gemini');
  });

  it('probes Gemini generation once and caches a successful readiness result', async () => {
    mockGeminiGenerate.mockResolvedValue({ text: 'ok' });

    await readinessModule.ensurePremiumAiProviderReady('gemini');
    await readinessModule.ensurePremiumAiProviderReady('gemini');

    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockResolveGeminiModelFallbackChain).toHaveBeenCalledTimes(1);
    expect(mockRecordPremiumAiProviderSuccess).toHaveBeenCalledWith('gemini');
    const request = mockGeminiGenerate.mock.calls[0]?.[0] as {
      contents?: string;
      config?: { maxOutputTokens?: number; thinkingConfig?: { thinkingLevel?: string } };
    };
    expect(request.contents).toBe('Reply with the single word ok.');
    expect(request.config?.maxOutputTokens).toBe(16);
    expect(request.config?.thinkingConfig?.thinkingLevel).toBe('MINIMAL');
  });

  it('treats Gemini 2.5 success as provider readiness when Gemini 3 fails', async () => {
    mockGeminiGenerate
      .mockRejectedValueOnce(Object.assign(new Error('model unavailable'), { status: 404, code: 'model_not_found' }))
      .mockResolvedValueOnce({ text: 'ok' });

    await readinessModule.ensurePremiumAiProviderReady('gemini');

    expect(mockGeminiGenerate).toHaveBeenCalledTimes(2);
    expect(mockGeminiGenerate.mock.calls[0]?.[0]).toMatchObject({ model: 'gemini-3-flash-preview' });
    expect(mockGeminiGenerate.mock.calls[1]?.[0]).toMatchObject({ model: 'gemini-2.5-flash' });
    expect(mockRecordPremiumAiProviderSuccess).toHaveBeenCalledWith('gemini');
  });
});
