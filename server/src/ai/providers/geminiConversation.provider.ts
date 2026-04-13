import { env } from '../../config/env.js';
import {
  createGoogleGenAIClient,
  geminiThinkingConfig,
  isGeminiModelFallbackEligibleError,
  isGemini3Model,
  resolveGeminiModelFallbackChain,
  withGeminiModelFallback,
} from '../../lib/googleGenAi.js';
import { withRetry } from '../../lib/retry.js';
import {
  recordPremiumProviderModelAttempt,
  recordPremiumProviderModelFailure,
  recordPremiumProviderModelSuccess,
} from '../../llm/premiumDiagnostics.js';
import {
  DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE,
  DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE,
  DEEP_INTERPOLATOR_RESPONSE_JSON_SCHEMA,
  buildUserPrompt,
  parseDeepInterpolatorOutputJson,
  sanitizeText,
  SYSTEM_PROMPT,
  type DeepInterpolatorOutput,
  type DeepInterpolatorResult,
  type PremiumInterpolatorRequest,
  validateDeepInterpolatorResult,
  withTimeout,
} from './deepInterpolatorShared.js';

export type {
  DeepInterpolatorResult,
  PremiumInterpolatorRequest,
  SummaryMode,
} from './deepInterpolatorShared.js';

const GEMINI_DEEP_HTTP_RETRY_ATTEMPTS = 3;
const GEMINI_3_DEEP_MAX_OUTPUT_TOKENS = 700;
const GEMINI_2_5_DEEP_MAX_OUTPUT_TOKENS = 4000;

function resolveGeminiTimeoutMs(model: string): number {
  const configured = Number.isFinite(env.PREMIUM_AI_TIMEOUT_MS) ? env.PREMIUM_AI_TIMEOUT_MS : 12_000;
  if (isGemini3Model(model)) {
    return Math.max(12_000, Math.min(configured, 15_000));
  }
  return Math.max(10_000, Math.min(configured, 12_000));
}

function resolveGeminiMaxOutputTokens(model: string): number {
  return isGemini3Model(model)
    ? GEMINI_3_DEEP_MAX_OUTPUT_TOKENS
    : GEMINI_2_5_DEEP_MAX_OUTPUT_TOKENS;
}

type GeminiStructuredResponse = {
  text?: string | undefined;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string | undefined;
      }>;
    } | undefined;
  }> | undefined;
};

function extractStructuredResponse(response: GeminiStructuredResponse): DeepInterpolatorOutput {
  const textCandidates = new Set<string>();
  const primaryText = sanitizeText(response.text ?? '');
  if (primaryText) {
    textCandidates.add(primaryText);
  }

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const joinedParts = sanitizeText(
    parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join(''),
  );
  if (joinedParts) {
    textCandidates.add(joinedParts);
  }

  let lastError: unknown;
  for (const candidate of textCandidates) {
    try {
      return parseDeepInterpolatorOutputJson(candidate);
    } catch (error) {
      if (candidate !== primaryText && (error as { code?: string })?.code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE) {
        continue;
      }
      lastError = error;
    }
  }

  if (lastError) {
    throw Object.assign(
      lastError instanceof Error ? lastError : new Error(String(lastError)),
      {
        message: (lastError as { code?: string })?.code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
          ? 'Gemini premium AI returned empty structured output'
          : 'Gemini premium AI returned invalid structured output',
        code: (lastError as { code?: string })?.code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
          ? DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
          : DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE,
        status: (lastError as { status?: number })?.status ?? 502,
        retryable: (lastError as { retryable?: unknown })?.retryable === true,
        preview: (lastError as { preview?: string })?.preview,
        responseChars: (lastError as { responseChars?: number })?.responseChars,
      },
    );
  }

  throw Object.assign(new Error('Gemini premium AI returned empty structured output'), {
    code: DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE,
    status: 502,
    retryable: false,
  });
}

export class GeminiConversationProvider {
  private readonly client = createGoogleGenAIClient();
  private readonly models: string[];

  constructor(
    model = env.GEMINI_DEEP_INTERPOLATOR_MODEL,
  ) {
    this.models = resolveGeminiModelFallbackChain('deep-interpolator', model);
  }

  async writeDeepInterpolator(
    request: PremiumInterpolatorRequest,
  ): Promise<DeepInterpolatorResult> {
    if (!this.client) {
      throw Object.assign(new Error('Gemini premium AI is not configured'), { status: 503 });
    }

    const prompt = buildUserPrompt(request);
    try {
      const { value: parsed } = await withGeminiModelFallback(
        this.models,
        async (model) => {
          const timeoutMs = resolveGeminiTimeoutMs(model);
          recordPremiumProviderModelAttempt({ provider: 'gemini', model });
          try {
            const parsed = await withRetry(
              async () => {
                const response = await withTimeout(
                  this.client!.models.generateContent({
                    model,
                    contents: `${SYSTEM_PROMPT}\n\n${prompt}`,
                    config: {
                      maxOutputTokens: resolveGeminiMaxOutputTokens(model),
                      responseMimeType: 'application/json',
                      responseJsonSchema: DEEP_INTERPOLATOR_RESPONSE_JSON_SCHEMA,
                      temperature: 0.35,
                      topP: 0.92,
                      ...geminiThinkingConfig(model, 'minimal'),
                      httpOptions: {
                        timeout: timeoutMs,
                        retryOptions: {
                          attempts: GEMINI_DEEP_HTTP_RETRY_ATTEMPTS,
                        },
                      },
                    },
                  }),
                  timeoutMs,
                );
                return extractStructuredResponse(response);
              },
              {
                attempts: env.PREMIUM_AI_RETRY_ATTEMPTS,
                baseDelayMs: 350,
                maxDelayMs: 3000,
                jitter: true,
                shouldRetry: (error) => {
                  const status = (error as { status?: number })?.status;
                  const code = (error as { code?: string })?.code;
                  const retryable = (error as { retryable?: unknown })?.retryable === true;
                  if ((code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE || code === DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE) && !retryable) {
                    return false;
                  }
                  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
                    return false;
                  }
                  return retryable || !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
                },
              },
            );
            recordPremiumProviderModelSuccess({ provider: 'gemini', model });
            return parsed;
          } catch (error) {
            recordPremiumProviderModelFailure({ provider: 'gemini', model });
            throw error;
          }
        },
        (error) => {
          const code = (error as { code?: string })?.code;
          if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
            return true;
          }
          return code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
            || code === DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE
            || isGeminiModelFallbackEligibleError(error);
        },
      );

      return validateDeepInterpolatorResult(parsed, 'gemini', request);
    } catch (error) {
      if (
        isGeminiModelFallbackEligibleError(error)
        && (error as { geminiFallbackExhausted?: unknown })?.geminiFallbackExhausted === true
      ) {
        const code = (error as { code?: string })?.code;
        if (code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE || code === DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE) {
          throw Object.assign(
            error instanceof Error ? error : new Error(String(error)),
            { status: 502, code },
          );
        }
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { status: 503, code: 'gemini_model_fallback_exhausted' },
        );
      }
      throw error;
    }
  }
}
