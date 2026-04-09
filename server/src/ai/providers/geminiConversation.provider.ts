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
  DEEP_INTERPOLATOR_RESPONSE_JSON_SCHEMA,
  buildUserPrompt,
  deepInterpolatorOutputSchema,
  extractJsonObject,
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
const GEMINI_EMPTY_OUTPUT_CODE = 'GEMINI_EMPTY_STRUCTURED_OUTPUT';
const GEMINI_INVALID_OUTPUT_CODE = 'GEMINI_INVALID_STRUCTURED_OUTPUT';

function resolveGeminiTimeoutMs(model: string): number {
  const configured = Number.isFinite(env.PREMIUM_AI_TIMEOUT_MS) ? env.PREMIUM_AI_TIMEOUT_MS : 12_000;
  if (isGemini3Model(model)) {
    return Math.max(12_000, Math.min(configured, 15_000));
  }
  return Math.max(10_000, Math.min(configured, 12_000));
}

function extractStructuredResponse(responseText: string): DeepInterpolatorOutput {
  const outputText = sanitizeText(responseText ?? '');
  if (!outputText) {
    throw Object.assign(new Error('Gemini premium AI returned empty structured output'), {
      code: GEMINI_EMPTY_OUTPUT_CODE,
      status: 502,
    });
  }

  try {
    return deepInterpolatorOutputSchema.parse(JSON.parse(extractJsonObject(outputText)));
  } catch {
    throw Object.assign(new Error('Gemini premium AI returned invalid structured output'), {
      code: GEMINI_INVALID_OUTPUT_CODE,
      status: 502,
    });
  }
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
          return withRetry(
            async () => {
              const response = await withTimeout(
                this.client!.models.generateContent({
                  model,
                  contents: `${SYSTEM_PROMPT}\n\n${prompt}`,
                  config: {
                    maxOutputTokens: 700,
                    responseMimeType: 'application/json',
                    responseJsonSchema: DEEP_INTERPOLATOR_RESPONSE_JSON_SCHEMA,
                    ...(!isGemini3Model(model)
                      ? {
                          temperature: 0.1,
                          topP: 0.9,
                        }
                      : {}),
                    ...geminiThinkingConfig(model, 'low'),
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
              return extractStructuredResponse(response.text ?? '');
            },
            {
              attempts: env.PREMIUM_AI_RETRY_ATTEMPTS,
              baseDelayMs: 350,
              maxDelayMs: 3000,
              jitter: true,
              shouldRetry: (error) => {
                const status = (error as { status?: number })?.status;
                const code = (error as { code?: string })?.code;
                if (code === GEMINI_EMPTY_OUTPUT_CODE || code === GEMINI_INVALID_OUTPUT_CODE) {
                  return false;
                }
                if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
                  return false;
                }
                return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
              },
            },
          );
        },
        (error) => {
          const code = (error as { code?: string })?.code;
          if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
            return true;
          }
          return code === GEMINI_EMPTY_OUTPUT_CODE
            || code === GEMINI_INVALID_OUTPUT_CODE
            || isGeminiModelFallbackEligibleError(error);
        },
      );

      return validateDeepInterpolatorResult(parsed, 'gemini');
    } catch (error) {
      if (
        isGeminiModelFallbackEligibleError(error)
        && (error as { geminiFallbackExhausted?: unknown })?.geminiFallbackExhausted === true
      ) {
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { status: 503, code: 'gemini_model_fallback_exhausted' },
        );
      }
      throw error;
    }
  }
}
