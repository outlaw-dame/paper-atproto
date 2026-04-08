import { env } from '../../config/env.js';
import {
  createGoogleGenAIClient,
  geminiThinkingConfig,
  isGemini3Model,
  resolveGeminiModel,
} from '../../lib/googleGenAi.js';
import { withRetry } from '../../lib/retry.js';
import {
  buildUserPrompt,
  extractJsonObject,
  sanitizeText,
  SYSTEM_PROMPT,
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

export class GeminiConversationProvider {
  private readonly client = createGoogleGenAIClient();
  private readonly model: string;

  constructor(
    model = env.GEMINI_DEEP_INTERPOLATOR_MODEL,
  ) {
    this.model = resolveGeminiModel('deep-interpolator', model);
  }

  async writeDeepInterpolator(
    request: PremiumInterpolatorRequest,
  ): Promise<DeepInterpolatorResult> {
    if (!this.client) {
      throw Object.assign(new Error('Gemini premium AI is not configured'), { status: 503 });
    }

    const prompt = buildUserPrompt(request);
    const model = this.model;

    const rawText = await withRetry(
      async () => {
        const response = await withTimeout(this.client!.models.generateContent({
          model,
          contents: `${SYSTEM_PROMPT}\n\n${prompt}`,
          config: {
            responseMimeType: 'application/json',
            ...(!isGemini3Model(model)
              ? {
                  temperature: 0.2,
                }
              : {}),
            ...geminiThinkingConfig(model, 'high'),
          },
        }), env.PREMIUM_AI_TIMEOUT_MS);
        const text = sanitizeText(response.text ?? '');
        if (!text) {
          throw Object.assign(new Error('Gemini premium AI returned empty output'), { status: 502 });
        }
        return text;
      },
      {
        attempts: env.PREMIUM_AI_RETRY_ATTEMPTS,
        baseDelayMs: 350,
        maxDelayMs: 3000,
        jitter: true,
        shouldRetry: (error) => {
          const status = (error as { status?: number })?.status;
          return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
        },
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(rawText));
    } catch {
      throw Object.assign(new Error('Gemini premium AI returned invalid JSON'), { status: 502 });
    }

    return validateDeepInterpolatorResult(parsed, 'gemini');
  }
}
