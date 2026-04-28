import OpenAI from 'openai';
import { env } from '../config/env.js';

function trimEnvValue(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveOpenAiApiKey(apiKey = env.OPENAI_API_KEY): string | null {
  return trimEnvValue(apiKey);
}

export function createOpenAIClient(apiKey = env.OPENAI_API_KEY): OpenAI | null {
  const resolvedApiKey = resolveOpenAiApiKey(apiKey);
  return resolvedApiKey ? new OpenAI({ apiKey: resolvedApiKey }) : null;
}

export function resolveOpenAiModel(modelOverride?: string | null): string {
  return trimEnvValue(modelOverride) ?? env.OPENAI_DEEP_INTERPOLATOR_MODEL;
}