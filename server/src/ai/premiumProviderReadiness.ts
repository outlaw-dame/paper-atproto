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
import { sanitizeText } from '../lib/sanitize.js';
import {
  classifyPremiumAiProviderOutage,
  isPersistentPremiumAiProviderOutageReason,
  isPremiumAiProviderOperational,
  recordPremiumAiProviderFailure,
  recordPremiumAiProviderSuccess,
  type PremiumAiProviderOutageReason,
  type PremiumAiProviderName,
} from './premiumProviderHealth.js';

type ReadinessEntry = {
  checkedAt: number;
  inFlight: Promise<void> | undefined;
  lastOutcome: 'success' | 'transient_failure' | 'persistent_failure' | undefined;
  lastFailureReason: PremiumAiProviderOutageReason | 'unknown' | undefined;
  lastFailureStatus: number | undefined;
  lastFailureCode: string | undefined;
  lastFailureMessage: string | undefined;
};

const READINESS_TTL_MS = 15 * 60_000;
const readinessState: Record<PremiumAiProviderName, ReadinessEntry> = {
  gemini: { checkedAt: 0, inFlight: undefined, lastOutcome: undefined, lastFailureReason: undefined, lastFailureStatus: undefined, lastFailureCode: undefined, lastFailureMessage: undefined },
  openai: { checkedAt: 0, inFlight: undefined, lastOutcome: undefined, lastFailureReason: undefined, lastFailureStatus: undefined, lastFailureCode: undefined, lastFailureMessage: undefined },
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

function shouldSuppressProviderFromReadinessProbe(error: unknown): boolean {
  const outageReason = classifyPremiumAiProviderOutage(error);
  return isPersistentPremiumAiProviderOutageReason(outageReason);
}

function normalizeFailureStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && Number.isFinite(status) ? Math.trunc(status) : undefined;
}

function normalizeFailureCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && code.trim() ? code.trim().toLowerCase() : undefined;
}

function normalizeFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const sanitized = sanitizeText(error.message).slice(0, 180);
  return sanitized || undefined;
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
      entry.lastOutcome = 'success';
      entry.lastFailureReason = undefined;
      entry.lastFailureStatus = undefined;
      entry.lastFailureCode = undefined;
      entry.lastFailureMessage = undefined;
      recordPremiumAiProviderSuccess(provider);
    } catch (error) {
      const outageReason = classifyPremiumAiProviderOutage(error) ?? 'unknown';
      entry.lastOutcome = shouldSuppressProviderFromReadinessProbe(error)
        ? 'persistent_failure'
        : 'transient_failure';
      entry.lastFailureReason = outageReason;
      entry.lastFailureStatus = normalizeFailureStatus(error);
      entry.lastFailureCode = normalizeFailureCode(error);
      entry.lastFailureMessage = normalizeFailureMessage(error);
      if (entry.lastOutcome === 'persistent_failure') {
        recordPremiumAiProviderFailure(provider, error);
      }
    } finally {
      readinessState[provider].checkedAt = Date.now();
      readinessState[provider].inFlight = undefined;
    }
  })();

  readinessState[provider].inFlight = probe;
  await probe;
}

export function resetPremiumAiProviderReadinessForTests(): void {
  readinessState.gemini = { checkedAt: 0, inFlight: undefined, lastOutcome: undefined, lastFailureReason: undefined, lastFailureStatus: undefined, lastFailureCode: undefined, lastFailureMessage: undefined };
  readinessState.openai = { checkedAt: 0, inFlight: undefined, lastOutcome: undefined, lastFailureReason: undefined, lastFailureStatus: undefined, lastFailureCode: undefined, lastFailureMessage: undefined };
}

export function resetPremiumAiProviderReadiness(): void {
  resetPremiumAiProviderReadinessForTests();
}

export function getPremiumAiProviderReadinessSnapshot(): Record<PremiumAiProviderName, {
  checkedAt: string | null;
  inFlight: boolean;
  lastOutcome: 'success' | 'transient_failure' | 'persistent_failure' | null;
  lastFailureReason: PremiumAiProviderOutageReason | 'unknown' | null;
  lastFailureStatus: number | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
}> {
  return {
    gemini: {
      checkedAt: readinessState.gemini.checkedAt ? new Date(readinessState.gemini.checkedAt).toISOString() : null,
      inFlight: Boolean(readinessState.gemini.inFlight),
      lastOutcome: readinessState.gemini.lastOutcome ?? null,
      lastFailureReason: readinessState.gemini.lastFailureReason ?? null,
      lastFailureStatus: readinessState.gemini.lastFailureStatus ?? null,
      lastFailureCode: readinessState.gemini.lastFailureCode ?? null,
      lastFailureMessage: readinessState.gemini.lastFailureMessage ?? null,
    },
    openai: {
      checkedAt: readinessState.openai.checkedAt ? new Date(readinessState.openai.checkedAt).toISOString() : null,
      inFlight: Boolean(readinessState.openai.inFlight),
      lastOutcome: readinessState.openai.lastOutcome ?? null,
      lastFailureReason: readinessState.openai.lastFailureReason ?? null,
      lastFailureStatus: readinessState.openai.lastFailureStatus ?? null,
      lastFailureCode: readinessState.openai.lastFailureCode ?? null,
      lastFailureMessage: readinessState.openai.lastFailureMessage ?? null,
    },
  };
}
