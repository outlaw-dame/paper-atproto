import type { RuntimeCapability } from './capabilityProbe';

export type RuntimeMode = 'fast' | 'balanced' | 'best_quality';

export type TaskKind =
  | 'hot_path_scoring'
  | 'text_generation'
  | 'multimodal_analysis';

export type ModelChoice =
  | 'worker_local_only'
  | 'qwen3_4b'
  | 'smollm3_3b'
  | 'phi4_mini'
  | 'qwen35_2b_mm'
  | 'qwen35_08b_mm'
  | 'qwen3_vl_4b';

export interface ModelPolicyDecision {
  task: TaskKind;
  choice: ModelChoice;
  fallbackChoices: ModelChoice[];
  localAllowed: boolean;
  remoteFallbackAllowed: boolean;
  requiresExplicitUserAction: boolean;
  reason: string;
}

export interface ModelPolicyInput {
  capability: RuntimeCapability;
  settingsMode: RuntimeMode;
  task: TaskKind;
  explicitUserAction?: boolean;
}

export function chooseModelForTask(input: ModelPolicyInput): ModelPolicyDecision {
  const explicitUserAction = input.explicitUserAction === true;

  if (input.task === 'hot_path_scoring') {
    return {
      task: input.task,
      choice: 'worker_local_only',
      fallbackChoices: [],
      localAllowed: true,
      remoteFallbackAllowed: false,
      requiresExplicitUserAction: false,
      reason: 'The hot-path classifier stack stays on the existing local worker pipeline.',
    };
  }

  if (input.task === 'text_generation') {
    return chooseTextGenerationModel(input.capability, input.settingsMode, explicitUserAction);
  }

  return chooseMultimodalModel(input.capability, input.settingsMode, explicitUserAction);
}

function chooseTextGenerationModel(
  capability: RuntimeCapability,
  settingsMode: RuntimeMode,
  explicitUserAction: boolean,
): ModelPolicyDecision {
  if (!capability.generationAllowed) {
    return unavailableDecision(
      'text_generation',
      'Premium local text generation is disabled for this session, so the app should keep the worker stack and use remote enhancement only when explicitly requested.',
    );
  }

  if (settingsMode === 'fast') {
    return unavailableDecision(
      'text_generation',
      'Fast mode keeps only the current local worker stack and avoids loading a large browser text model.',
    );
  }

  if (capability.tier === 'low' && !explicitUserAction) {
    return unavailableDecision(
      'text_generation',
      'Low-tier devices stay on the classifier-only baseline until the user explicitly asks for generation.',
    );
  }

  if (settingsMode === 'best_quality' && capability.tier === 'high') {
    return {
      task: 'text_generation',
      choice: 'qwen3_4b',
      fallbackChoices: ['smollm3_3b', 'phi4_mini'],
      localAllowed: true,
      remoteFallbackAllowed: true,
      requiresExplicitUserAction: false,
      reason: 'Best quality mode on a high-tier device prefers Qwen3-4B, then falls back to SmolLM3-3B and Phi-4 mini.',
    };
  }

  return {
    task: 'text_generation',
    choice: 'smollm3_3b',
    fallbackChoices: ['phi4_mini'],
    localAllowed: true,
    remoteFallbackAllowed: true,
    requiresExplicitUserAction: capability.tier === 'low',
    reason:
      capability.tier === 'low'
        ? 'A low-tier device passed the probe, so explicit generation can use SmolLM3-3B with Phi-4 mini as a fallback.'
        : 'Balanced or mid-tier text generation defaults to SmolLM3-3B, with Phi-4 mini reserved as the lighter fallback.',
  };
}

function chooseMultimodalModel(
  capability: RuntimeCapability,
  settingsMode: RuntimeMode,
  explicitUserAction: boolean,
): ModelPolicyDecision {
  if (!explicitUserAction) {
    return {
      task: 'multimodal_analysis',
      choice: 'worker_local_only',
      fallbackChoices: [],
      localAllowed: false,
      remoteFallbackAllowed: true,
      requiresExplicitUserAction: true,
      reason: 'Multimodal analysis must stay on-demand and should never preload implicitly.',
    };
  }

  if (!capability.multimodalAllowed) {
    return unavailableDecision(
      'multimodal_analysis',
      'Premium local multimodal analysis is unavailable for this session, so the app should keep the worker stack and use remote analysis when enabled.',
    );
  }

  if (settingsMode === 'fast') {
    return unavailableDecision(
      'multimodal_analysis',
      'Fast mode keeps multimodal analysis remote-only and on-demand.',
    );
  }

  if (capability.tier === 'high') {
    return {
      task: 'multimodal_analysis',
      choice: 'qwen3_vl_4b',
      fallbackChoices: ['qwen35_2b_mm', 'qwen35_08b_mm'],
      localAllowed: true,
      remoteFallbackAllowed: true,
      requiresExplicitUserAction: true,
      reason: 'High-tier multimodal flows prefer Qwen3-VL-4B and fall back down the Qwen3.5 ladder only when needed.',
    };
  }

  if (capability.tier === 'mid') {
    return {
      task: 'multimodal_analysis',
      choice: 'qwen35_2b_mm',
      fallbackChoices: ['qwen35_08b_mm'],
      localAllowed: true,
      remoteFallbackAllowed: true,
      requiresExplicitUserAction: true,
      reason: 'Mid-tier multimodal flows default to Qwen3.5-2B and drop to 0.8B when headroom is tight.',
    };
  }

  return {
    task: 'multimodal_analysis',
    choice: 'qwen35_08b_mm',
    fallbackChoices: [],
    localAllowed: true,
    remoteFallbackAllowed: true,
    requiresExplicitUserAction: true,
    reason: 'Low-tier multimodal remains explicit and uses the smallest Qwen3.5 path only as a last resort.',
  };
}

function unavailableDecision(
  task: Exclude<TaskKind, 'hot_path_scoring'>,
  reason: string,
): ModelPolicyDecision {
  return {
    task,
    choice: 'worker_local_only',
    fallbackChoices: [],
    localAllowed: false,
    remoteFallbackAllowed: true,
    requiresExplicitUserAction: task === 'multimodal_analysis',
    reason,
  };
}
