import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../../config/env.js';
import { createOpenAIClient, resolveOpenAiModel } from '../../lib/openAi.js';
import { withRetry } from '../../lib/retry.js';
import {
  recordPremiumProviderModelAttempt,
  recordPremiumProviderModelFailure,
  recordPremiumProviderModelSuccess,
} from '../../llm/premiumDiagnostics.js';
import {
  buildUserPrompt,
  deepInterpolatorOutputSchema,
  parseDeepInterpolatorOutputJson,
  DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE,
  DEEP_INTERPOLATOR_INVALID_OUTPUT_CODE,
  SYSTEM_PROMPT,
  type DeepInterpolatorOutput,
  type DeepInterpolatorResult,
  type PremiumInterpolatorRequest,
  validateDeepInterpolatorResult,
  withTimeout,
} from './deepInterpolatorShared.js';

const OPENAI_DEEP_INTERPOLATOR_FORMAT = zodTextFormat(
  deepInterpolatorOutputSchema,
  'glympse_deep_interpolator',
  {
    description: 'Premium deep conversation synthesis for the Glympse Conversation OS.',
  },
);

const OPENAI_EMPTY_OUTPUT_CODE = 'OPENAI_EMPTY_STRUCTURED_OUTPUT';
const OPENAI_INVALID_OUTPUT_CODE = 'OPENAI_INVALID_STRUCTURED_OUTPUT';

function extractStructuredResponse(
  response: {
    output_parsed: DeepInterpolatorOutput | null;
    output_text?: string;
  },
): DeepInterpolatorOutput {
  if (response.output_parsed) {
    return response.output_parsed;
  }
  try {
    return parseDeepInterpolatorOutputJson(response.output_text ?? '');
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      {
        message: (error as { code?: string })?.code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
          ? 'OpenAI premium AI returned empty structured output'
          : 'OpenAI premium AI returned invalid structured output',
        code: (error as { code?: string })?.code === DEEP_INTERPOLATOR_EMPTY_OUTPUT_CODE
          ? OPENAI_EMPTY_OUTPUT_CODE
          : OPENAI_INVALID_OUTPUT_CODE,
        status: (error as { status?: number })?.status ?? 502,
      },
    );
  }
}

export class OpenAIConversationProvider {
  private readonly client = createOpenAIClient();
  private readonly model: string;

  constructor(model = env.OPENAI_DEEP_INTERPOLATOR_MODEL) {
    this.model = resolveOpenAiModel(model);
  }

  async writeDeepInterpolator(
    request: PremiumInterpolatorRequest,
  ): Promise<DeepInterpolatorResult> {
    if (!this.client) {
      throw Object.assign(new Error('OpenAI premium AI is not configured'), { status: 503 });
    }

    const prompt = buildUserPrompt(request);
    recordPremiumProviderModelAttempt({ provider: 'openai', model: this.model });
    let parsed: DeepInterpolatorOutput;
    try {
      parsed = await withRetry(
        async () => {
          const response = await withTimeout(
            this.client!.responses.parse({
              model: this.model,
              instructions: SYSTEM_PROMPT,
              input: prompt,
              max_output_tokens: 700,
              temperature: 0.35,
              top_p: 0.92,
              store: false,
              text: {
                format: OPENAI_DEEP_INTERPOLATOR_FORMAT,
                verbosity: 'low',
              },
            }),
            env.PREMIUM_AI_TIMEOUT_MS,
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
    } catch (error) {
      recordPremiumProviderModelFailure({ provider: 'openai', model: this.model });
      throw error;
    }
    recordPremiumProviderModelSuccess({ provider: 'openai', model: this.model });

    return validateDeepInterpolatorResult(parsed, 'openai', request);
  }
}
