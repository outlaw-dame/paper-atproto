import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { env } from '../config/env.js';

export type GeminiModelLane = 'composer' | 'deep-interpolator' | 'grounding' | 'interpolator-enhancer';
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export type GeminiModelFallbackContext = {
  model: string;
  attempt: number;
  nextModel: string | null;
  attemptedModels: string[];
};

const GEMINI_THINKING_LEVEL_MAP: Record<GeminiThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

function trimEnvValue(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGeminiModelList(value?: string | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => trimEnvValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function fallbackModelsForLane(lane: GeminiModelLane): string[] {
  switch (lane) {
    case 'deep-interpolator':
      return parseGeminiModelList(env.GEMINI_DEEP_INTERPOLATOR_FALLBACK_MODELS);
    case 'interpolator-enhancer':
      return parseGeminiModelList(env.GEMINI_INTERPOLATOR_ENHANCER_FALLBACK_MODELS);
    default:
      return [];
  }
}

function normalizeProviderStatus(error: unknown): number | undefined {
  const rawStatus = (error as { status?: unknown })?.status;
  return typeof rawStatus === 'number' && Number.isFinite(rawStatus)
    ? Math.trunc(rawStatus)
    : undefined;
}

function normalizeProviderCode(error: unknown): string {
  const rawCode = (error as { code?: unknown })?.code;
  return typeof rawCode === 'string' ? rawCode.trim().toLowerCase() : '';
}

export function resolveGeminiApiKey(apiKey = env.GEMINI_API_KEY): string | null {
  return trimEnvValue(apiKey);
}

export function createGoogleGenAIClient(apiKey = env.GEMINI_API_KEY): GoogleGenAI | null {
  const resolvedApiKey = resolveGeminiApiKey(apiKey);
  return resolvedApiKey ? new GoogleGenAI({ apiKey: resolvedApiKey }) : null;
}

export function isGemini3Model(model: string | null | undefined): boolean {
  const normalized = trimEnvValue(model)?.toLowerCase();
  return normalized?.startsWith('gemini-3') ?? false;
}

export function geminiThinkingConfig(
  model: string | null | undefined,
  thinkingLevel: GeminiThinkingLevel,
): { thinkingConfig: { thinkingLevel: ThinkingLevel } } | {} {
  if (!isGemini3Model(model)) return {};
  return {
    thinkingConfig: {
      thinkingLevel: GEMINI_THINKING_LEVEL_MAP[thinkingLevel],
    },
  };
}

export function resolveGeminiModel(
  lane: GeminiModelLane,
  modelOverride?: string | null,
): string {
  const override = trimEnvValue(modelOverride);
  if (override) return override;

  switch (lane) {
    case 'composer':
      return env.GEMINI_COMPOSER_MODEL;
    case 'deep-interpolator':
      return env.GEMINI_DEEP_INTERPOLATOR_MODEL;
    case 'grounding':
      return env.GEMINI_GROUNDING_MODEL;
    case 'interpolator-enhancer':
      return env.GEMINI_INTERPOLATOR_ENHANCER_MODEL;
  }
}

export function resolveGeminiModelFallbackChain(
  lane: GeminiModelLane,
  modelOverride?: string | null,
): string[] {
  const primaryModel = resolveGeminiModel(lane, modelOverride);
  return Array.from(new Set([primaryModel, ...fallbackModelsForLane(lane)]));
}

export function isGeminiModelFallbackEligibleError(error: unknown): boolean {
  const status = normalizeProviderStatus(error);
  if (typeof status === 'number' && [400, 401, 403, 404, 408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = normalizeProviderCode(error);
  if ([
    'deadline_exceeded',
    'failed_precondition',
    'invalid_argument',
    'model_not_found',
    'not_found',
    'permission_denied',
    'resource_exhausted',
    'service_unavailable',
    'too_many_requests',
    'unavailable',
  ].includes(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('deadline exceeded')
    || message.includes('model not found')
    || message.includes('permission denied')
    || message.includes('rate limit')
    || message.includes('resource exhausted')
    || message.includes('service unavailable')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('unsupported')
    || message.includes('unavailable');
}

export async function withGeminiModelFallback<T>(
  models: string[],
  runner: (model: string) => Promise<T>,
  shouldFallback: (error: unknown, context: GeminiModelFallbackContext) => boolean = (error) => isGeminiModelFallbackEligibleError(error),
): Promise<{ model: string; value: T }> {
  const uniqueModels = Array.from(
    new Set(models.map((model) => trimEnvValue(model)).filter((model): model is string => Boolean(model))),
  );

  let lastError: unknown;
  const attemptedModels: string[] = [];

  for (let attempt = 0; attempt < uniqueModels.length; attempt += 1) {
    const model = uniqueModels[attempt]!;
    const nextModel = uniqueModels[attempt + 1] ?? null;
    attemptedModels.push(model);
    try {
      return {
        model,
        value: await runner(model),
      };
    } catch (error) {
      lastError = error;
      const context: GeminiModelFallbackContext = {
        model,
        attempt,
        nextModel,
        attemptedModels: [...attemptedModels],
      };
      if (!nextModel || !shouldFallback(error, context)) {
        const baseError = error instanceof Error ? error : new Error(String(error));
        throw Object.assign(baseError, {
          geminiAttemptedModels: context.attemptedModels,
          geminiFallbackExhausted: nextModel === null,
        });
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error('Gemini model fallback chain failed without an error'));
}
