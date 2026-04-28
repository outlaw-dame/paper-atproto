import { withRetry } from '../lib/retry.js';
import { env } from '../config/env.js';
import {
  createGoogleGenAIClient,
  geminiThinkingConfig,
  isGeminiModelFallbackEligibleError,
  isGemini3Model,
  resolveGeminiModelFallbackChain,
  withGeminiModelFallback,
} from '../lib/googleGenAi.js';
import {
  buildInterpolatorEnhancerPrompt,
  INTERPOLATOR_ENHANCER_RESPONSE_JSON_SCHEMA,
  INTERPOLATOR_ENHANCER_SYSTEM_PROMPT,
  parseInterpolatorEnhancerJson,
  sanitizeEnhancerText,
  type InterpolatorEnhancerDecision,
  type InterpolatorEnhancerProviderReview,
  type InterpolatorEnhancerReviewInput,
  validateInterpolatorEnhancerDecision,
} from './interpolatorEnhancerShared.js';

const ENHANCER_HTTP_RETRY_ATTEMPTS = 3;

function resolveTimeoutMs(model: string): number {
  const configured = Number.isFinite(env.LLM_TIMEOUT_MS) ? env.LLM_TIMEOUT_MS : 10_000;
  if (isGemini3Model(model)) {
    return Math.max(12_000, Math.min(configured + 4_000, 15_000));
  }
  return Math.max(10_000, Math.min(configured, 12_000));
}

export async function reviewWithGeminiInterpolatorEnhancer(
  params: InterpolatorEnhancerReviewInput,
): Promise<InterpolatorEnhancerProviderReview> {
  const client = createGoogleGenAIClient();
  if (!client) {
    throw Object.assign(new Error('Gemini interpolator enhancer is not configured'), { status: 503 });
  }

  const prompt = buildInterpolatorEnhancerPrompt(params);
  const models = resolveGeminiModelFallbackChain('interpolator-enhancer', env.GEMINI_INTERPOLATOR_ENHANCER_MODEL);

  try {
    const { model, value: rawText } = await withGeminiModelFallback(
      models,
      async (activeModel) => {
        const timeoutMs = resolveTimeoutMs(activeModel);
        return withRetry(
          async () => {
            const response = await client.models.generateContent({
              model: activeModel,
              contents: `${INTERPOLATOR_ENHANCER_SYSTEM_PROMPT}\n\n${prompt}`,
              config: {
                maxOutputTokens: 420,
                responseMimeType: 'application/json',
                responseJsonSchema: INTERPOLATOR_ENHANCER_RESPONSE_JSON_SCHEMA,
                ...(!isGemini3Model(activeModel)
                  ? {
                      temperature: 0.1,
                      topP: 0.85,
                    }
                  : {}),
                ...geminiThinkingConfig(activeModel, 'minimal'),
                httpOptions: {
                  timeout: timeoutMs,
                  retryOptions: {
                    attempts: ENHANCER_HTTP_RETRY_ATTEMPTS,
                  },
                },
              },
            });
            const text = sanitizeEnhancerText(response.text ?? '', 8_000);
            if (!text) {
              throw Object.assign(new Error('Gemini interpolator enhancer returned empty output'), {
                code: 'GEMINI_EMPTY_INTERPOLATOR_ENHANCER_OUTPUT',
                status: 502,
              });
            }
            parseInterpolatorEnhancerJson(text);
            return text;
          },
          {
            attempts: 2,
            baseDelayMs: 300,
            maxDelayMs: 1_200,
            jitter: true,
            shouldRetry: (error) => {
              const status = (error as { status?: number })?.status;
              const retryable = (error as { retryable?: unknown })?.retryable === true;
              return retryable || (!status || [408, 425, 429, 500, 502, 503, 504].includes(status));
            },
          },
        );
      },
      (error) => {
        const code = (error as { code?: string })?.code;
        return code === 'GEMINI_EMPTY_INTERPOLATOR_ENHANCER_OUTPUT'
          || isGeminiModelFallbackEligibleError(error);
      },
    );

    return {
      model,
      decision: validateInterpolatorEnhancerDecision(parseInterpolatorEnhancerJson(rawText)),
    };
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
