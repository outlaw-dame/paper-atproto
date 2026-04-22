import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import { createOpenAIClient, resolveOpenAiModel } from '../lib/openAi.js';
import { withRetry } from '../lib/retry.js';
import {
  buildInterpolatorEnhancerPrompt,
  INTERPOLATOR_ENHANCER_SYSTEM_PROMPT,
  interpolatorEnhancerDecisionSchema,
  parseInterpolatorEnhancerJson,
  sanitizeEnhancerText,
  type InterpolatorEnhancerDecision,
  type InterpolatorEnhancerProviderReview,
  type InterpolatorEnhancerReviewInput,
  validateInterpolatorEnhancerDecision,
} from './interpolatorEnhancerShared.js';

const OPENAI_INTERPOLATOR_ENHANCER_FORMAT = zodTextFormat(
  interpolatorEnhancerDecisionSchema,
  'glympse_interpolator_enhancer_review',
  {
    description: 'Canonical Interpolator review and takeover decision for Glympse.',
  },
);

const OPENAI_EMPTY_OUTPUT_CODE = 'OPENAI_EMPTY_INTERPOLATOR_ENHANCER_OUTPUT';
const OPENAI_INVALID_OUTPUT_CODE = 'OPENAI_INVALID_INTERPOLATOR_ENHANCER_OUTPUT';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('OpenAI interpolator enhancer timed out'), { status: 504 }));
    }, timeoutMs);

    Promise.resolve(promise)
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

function extractStructuredResponse(
  response: {
    output_parsed: InterpolatorEnhancerDecision | null;
    output_text?: string;
  },
): InterpolatorEnhancerDecision {
  if (response.output_parsed) {
    return validateInterpolatorEnhancerDecision(response.output_parsed);
  }

  const outputText = sanitizeEnhancerText(response.output_text ?? '', 8_000);
  if (!outputText) {
    throw Object.assign(new Error('OpenAI interpolator enhancer returned empty structured output'), {
      code: OPENAI_EMPTY_OUTPUT_CODE,
      status: 502,
    });
  }

  try {
    return validateInterpolatorEnhancerDecision(parseInterpolatorEnhancerJson(outputText));
  } catch {
    throw Object.assign(new Error('OpenAI interpolator enhancer returned invalid structured output'), {
      code: OPENAI_INVALID_OUTPUT_CODE,
      status: 502,
    });
  }
}

export async function reviewWithOpenAiInterpolatorEnhancer(
  params: InterpolatorEnhancerReviewInput,
): Promise<InterpolatorEnhancerProviderReview> {
  const client = createOpenAIClient();
  if (!client) {
    throw Object.assign(new Error('OpenAI interpolator enhancer is not configured'), { status: 503 });
  }

  const model = resolveOpenAiModel(env.OPENAI_INTERPOLATOR_ENHANCER_MODEL);
  const prompt = buildInterpolatorEnhancerPrompt(params);
  const configuredTimeout = Number.isFinite(env.LLM_TIMEOUT_MS) ? env.LLM_TIMEOUT_MS : 12_000;
  const timeoutMs = Math.max(10_000, Math.min(configuredTimeout, 15_000));

  const decision = await withRetry(
    async () => {
      const response = await withTimeout(client.responses.parse({
        model,
        instructions: INTERPOLATOR_ENHANCER_SYSTEM_PROMPT,
        input: prompt,
        max_output_tokens: 650,
        store: false,
        text: {
          format: OPENAI_INTERPOLATOR_ENHANCER_FORMAT,
          verbosity: 'low',
        },
      }), timeoutMs);
      return extractStructuredResponse(response);
    },
    {
      attempts: 2,
      baseDelayMs: 300,
      maxDelayMs: 1_200,
      jitter: true,
      shouldRetry: (error) => {
        const status = (error as { status?: number })?.status;
        const code = (error as { code?: string })?.code;
        if (code === OPENAI_EMPTY_OUTPUT_CODE || code === OPENAI_INVALID_OUTPUT_CODE) {
          return false;
        }
        if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
          return false;
        }
        return !status || [408, 425, 429, 500, 502, 503, 504].includes(status);
      },
    },
  );
  return {
    model,
    decision,
  };
}
