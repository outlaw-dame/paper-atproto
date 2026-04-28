import { functionGemmaRouterPromptV1 } from './routerPrompt';
import { runtimeCoordinatorPromptV1 } from './coordinatorPrompt';

export const runtimePromptRegistry = {
  router: functionGemmaRouterPromptV1,
  coordinator: runtimeCoordinatorPromptV1,
} as const;

export type RuntimePromptRole = keyof typeof runtimePromptRegistry;
export type RuntimePrompt = typeof runtimePromptRegistry[RuntimePromptRole];

export function getRuntimePrompt(role: RuntimePromptRole): RuntimePrompt {
  return runtimePromptRegistry[role];
}
