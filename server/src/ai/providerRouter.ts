import {
  GeminiConversationProvider,
  type DeepInterpolatorResult,
  type PremiumInterpolatorRequest,
} from './providers/geminiConversation.provider.js';

const geminiConversationProvider = new GeminiConversationProvider();

export async function writePremiumDeepInterpolator(
  request: PremiumInterpolatorRequest,
): Promise<DeepInterpolatorResult> {
  return geminiConversationProvider.writeDeepInterpolator(request);
}
