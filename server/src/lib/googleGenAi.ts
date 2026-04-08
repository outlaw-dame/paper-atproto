import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { env } from '../config/env.js';

export type GeminiModelLane = 'composer' | 'deep-interpolator' | 'grounding' | 'interpolator-enhancer';
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

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
