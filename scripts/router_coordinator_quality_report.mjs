#!/usr/bin/env node

import { buildSessionBrief } from '../src/intelligence/coordinator/sessionBrief.ts';
import { __adviseInternalForTesting } from '../src/intelligence/coordinator/intelligenceCoordinator.ts';
import { chooseModelForTask } from '../src/runtime/modelPolicy.ts';
import { selectAiStackProfile } from '../src/runtime/aiStackProfile.ts';
import { buildCoordinationContract } from '../src/runtime/routerCoordinatorContract.ts';

const HIGH_CAPABILITY = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  browserFamily: 'chromium',
  deviceMemoryGiB: 16,
  hardwareConcurrency: 12,
};

const SCENARIOS = [
  {
    id: 'composer_refine',
    brief: buildSessionBrief({
      surface: 'composer',
      intent: 'composer_refine',
      explicitUserAction: true,
      attachments: { hasImages: false, hasLinks: false, hasCode: false },
    }),
  },
  {
    id: 'story_summary',
    brief: buildSessionBrief({
      surface: 'session',
      intent: 'story_summary',
      attachments: { hasImages: false, hasLinks: true, hasCode: false },
    }),
  },
  {
    id: 'media_analysis',
    brief: buildSessionBrief({
      surface: 'media',
      intent: 'media_analysis',
      attachments: { hasImages: true, hasLinks: false, hasCode: false },
    }),
  },
];

function summarizeAdvice(id, advice) {
  return {
    id,
    lane: advice.lane,
    deterministicFallback: advice.deterministicFallback,
    laneReasonCode: advice.laneReasonCode,
    reasonCodes: advice.reasonCodes,
    edgePlan: advice.edgePlan
      ? {
          capability: advice.edgePlan.capability,
          provider: advice.edgePlan.provider,
          endpoint: advice.edgePlan.endpoint,
          fallbackProvider: advice.edgePlan.fallbackProvider ?? null,
        }
      : null,
    routerResult: advice.routerResult
      ? {
          status: advice.routerResult.status,
          selectedModel: advice.routerResult.selectedModel,
          deterministicFallback: advice.routerResult.deterministicFallback,
        }
      : null,
  };
}

function summarizeContract(task, explicitUserAction = false) {
  const policyDecision = chooseModelForTask({
    capability: HIGH_CAPABILITY,
    settingsMode: 'best_quality',
    task,
    explicitUserAction,
  });
  const stackProfile = selectAiStackProfile(HIGH_CAPABILITY, {
    settingsMode: 'best_quality',
    allowLiteRt: true,
    preferLiteRt: true,
    userConsentedToLargeModels: true,
    availableStorageGiB: 16,
  });
  const contract = buildCoordinationContract({ policyDecision, stackProfile });
  return {
    task,
    explicitUserAction,
    defaultRouteId: contract.defaultRouteId,
    fallbackRouteId: contract.fallbackRouteId,
    allowedRoutes: contract.allowedRoutes.map((route) => ({
      id: route.id,
      kind: route.kind,
      model: route.model,
      allowed: route.allowed,
      remoteFallbackAllowed: route.remoteFallbackAllowed,
    })),
  };
}

async function main() {
  const results = [];
  for (const scenario of SCENARIOS) {
    const advice = await __adviseInternalForTesting(scenario.brief);
    results.push(summarizeAdvice(scenario.id, advice));
  }

  const media = results.find((entry) => entry.id === 'media_analysis');
  const coordinationContracts = [
    summarizeContract('text_generation', true),
    summarizeContract('multimodal_analysis', false),
    summarizeContract('multimodal_analysis', true),
  ];
  const textContract = coordinationContracts.find((entry) => entry.task === 'text_generation');
  const multimodalContract = coordinationContracts.find((entry) => entry.task === 'multimodal_analysis' && !entry.explicitUserAction);
  const summary = {
    generatedAt: new Date().toISOString(),
    results,
    coordinationContracts,
    assertions: {
      mediaUsesCloudflareEdgePlan: media?.edgePlan?.provider === 'cloudflare-workers-ai',
      mediaUsesDedicatedWorkersEndpoint: media?.edgePlan?.endpoint === '/api/edge/media-classify',
      textGenerationContractDoesNotAdvertisePlannedGemmaRoutes: textContract?.allowedRoutes.every((route) => (
        route.id !== 'model:gemma4_e4b' && route.id !== 'model:gemma4_e2b'
      )) === true,
      textGenerationContractHasWorkersAiRoute: textContract?.allowedRoutes.some((route) => route.id === 'edge:workers-ai' && route.kind === 'edge_workers_ai') === true,
      multimodalContractHasWorkersAiFallback: multimodalContract?.fallbackRouteId === 'edge:workers-ai',
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (Object.values(summary.assertions).some((value) => value !== true)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});