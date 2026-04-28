import { z } from 'zod';
import type { PremiumAiProviderPreference } from '../entitlements/resolveAiEntitlements.js';
import { ValidationError } from '../lib/errors.js';

export const PREMIUM_AI_PROVIDER_HEADER = 'X-Glympse-AI-Provider';
export const PremiumAiProviderPreferenceSchema = z.enum(['auto', 'gemini', 'openai']);

export function parsePremiumAiProviderPreferenceHeader(
  rawValue: string | undefined,
): PremiumAiProviderPreference | undefined {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) return undefined;

  const parsed = PremiumAiProviderPreferenceSchema.safeParse(rawValue.trim().toLowerCase());
  if (!parsed.success) {
    throw new ValidationError('Invalid premium AI provider preference.', {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
