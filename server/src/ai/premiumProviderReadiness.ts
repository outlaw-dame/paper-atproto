import { env } from '../config/env.js';
import { withRetry } from '../lib/retry.js';
import {
  createGoogleGenAIClient,
  geminiThinkingConfig,
  isGeminiModelFallbackEligibleError,
  isGemini3Model,
  resolveGeminiModelFallbackChain,
  withGeminiModelFallback,
} from '../lib/googleGenAi.js';
import { createOpenAIClient, resolveOpenAiModel } from '../lib/openAi.js';
import {
  isPremiumAiProviderOperational,
  recordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess,
  type PremiumAiProviderName,
} from './premiumProviderHealth.js';

type ReadinessEntry = {
  checkedAt: number;
  inFlight: Promise<void> | undefined;
};

const READINESS_TTL_MS = 15 * 60_000;
const readinessState: Record<PremiumAiProviderName, ReadinessEntry> = {
  gemini: { checkedAt: 0, inFlight: undefined },
  openai: { checkedAt: 0, inFlight: undefined },
};

async function withProbeTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Premium AI readiness probe timed out'), { status: 504 }));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function probeOpenAiReadiness(): Promise<void> {
  const client = createOpenAIClient();
  if (!client) return;

  await withRetry(
    async () => {
      await withProbeTimeout(
        client.responses.create({
          model: resolveOpenAiModel(),
          input: 'Reply with the single word ok.',
          max_output_tokens: 16,
          store: false,
        }),
        Math.min(env.PREMIUM_AI_TIMEOUT_MS, 12_000),
      );
    },
    {
      attempts: Math.min(env.PREMIUM_AI_RETRY_ATTEMPTS, 2),
      baseDelayMs: 250,
      maxDelayMs: 1500,
      jitter: true,
      shouldRetry: (error) => {
        const status = (error as { status?: number })?.status;
        const code = (error as { code?: string })?.code;
        if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
          return false;
        }
        return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
      },
    },
  );
}

async function probeGeminiReadiness(): Promise<void> {
  const client = createGoogleGenAIClient();
  if (!client) return;

  const models = resolveGeminiModelFallbackChain('deep-interpolator', env.GEMINI_DEEP_INTERPOLATOR_MODEL);

  await withGeminiModelFallback(
    models,
    async (model) => withRetry(
      async () => {
        await withProbeTimeout(
          client.models.generateContent({
            model,
            contents: 'Reply with the single word ok.',
            config: {
              maxOutputTokens: 16,
              ...(!isGemini3Model(model)
                ? {
                    temperature: 0,
                  }
                : {}),
              ...geminiThinkingConfig(model, 'minimal'),
            },
          }),
          Math.min(env.PREMIUM_AI_TIMEOUT_MS, 12_000),
        );
      },
      {
        attempts: Math.min(env.PREMIUM_AI_RETRY_ATTEMPTS, 2),
        baseDelayMs: 250,
        maxDelayMs: 1500,
        jitter: true,
        shouldRetry: (error) => {
          const status = (error as { status?: number })?.status;
          const code = (error as { code?: string })?.code;
          if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
            return false;
          }
          return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
        },
      },
    ),
    (error) => {
      const code = (error as { code?: string })?.code;
      if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
        return true;
      }
      return isGeminiModelFallbackEligibleError(error);
    },
  );
}

async function runReadinessProbe(provider: PremiumAiProviderName): Promise<void> {
  if (provider === 'openai') {
    await probeOpenAiReadiness();
    return;
  }
  await probeGeminiReadiness();
}

export async function ensurePremiumAiProviderReady(
  provider: PremiumAiProviderName | 'auto' | undefined,
): Promise<void> {
  if (!provider || provider === 'auto') return;
  if (!isPremiumAiProviderOperational(provider)) return;

  const entry = readinessState[provider];
  if (entry.inFlight) {
    await entry.inFlight;
    return;
  }

  if (Date.now() - entry.checkedAt < READINESS_TTL_MS) {
    return;
  }

  const probe = (async () => {
    try {
      await runReadinessProbe(provider);
      recordPremiumAiProviderSuccess(provider);
    } catch (error) {
      recordPremiumAiProviderFailure(provider, error);
    } finally {
      readinessState[provider].checkedAt = Date.now();
      readinessState[provider].inFlight = undefined;
    }
  })();

  readinessState[provider].inFlight = probe;
  await probe;
}

export function resetPremiumAiProviderReadinessForTests(): void {
  readinessState.gemini = { checkedAt: 0, inFlight: undefined };
  readinessState.openai = { checkedAt: 0, inFlight: undefined };
}
