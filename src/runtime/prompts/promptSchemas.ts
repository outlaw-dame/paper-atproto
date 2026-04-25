import { z } from 'zod';
import type { CoordinationContract } from '../routerCoordinatorContract';

export const PROMPT_SCHEMA_VERSION = 1 as const;
export const ROUTER_PROMPT_ID = 'functiongemma-router' as const;
export const COORDINATOR_PROMPT_ID = 'runtime-coordinator' as const;
export const ROUTER_PROMPT_VERSION = 1 as const;
export const COORDINATOR_PROMPT_VERSION = 1 as const;

export const coordinationReasonCodeSchema = z.enum([
  'policy_selected_primary',
  'policy_selected_fallback',
  'policy_requires_explicit_action',
  'policy_disallows_local',
  'policy_allows_remote_fallback',
  'validator_rejected_unknown_route',
  'validator_rejected_disallowed_route',
  'validator_rejected_schema',
  'validator_rejected_confidence',
  'validator_rejected_ttl',
  'validator_rejected_constraints',
]);

export const routerDecisionTypeSchema = z.enum(['route', 'fallback', 'abstain']);
export const coordinatorRecommendationSchema = z.enum([
  'accept_route',
  'prefer_fallback',
  'abstain',
  'flag_for_review',
]);

export const coordinatorWatchFlagSchema = z.enum([
  'stale_output',
  'low_confidence',
  'model_error',
  'latency_regression',
  'policy_violation',
]);

const routeIdSchema = z.string().min(1).max(128);

export const routerPromptOutputSchema = z.object({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  promptId: z.literal(ROUTER_PROMPT_ID),
  promptVersion: z.literal(ROUTER_PROMPT_VERSION),
  contractId: z.string().min(1).max(160),
  decisionType: routerDecisionTypeSchema,
  selectedRouteId: routeIdSchema,
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(coordinationReasonCodeSchema).min(1).max(4),
  ttlMs: z.number().int().min(250).max(15_000),
}).strict();

export const coordinatorPromptOutputSchema = z.object({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  promptId: z.literal(COORDINATOR_PROMPT_ID),
  promptVersion: z.literal(COORDINATOR_PROMPT_VERSION),
  contractId: z.string().min(1).max(160),
  recommendation: coordinatorRecommendationSchema,
  selectedRouteId: routeIdSchema,
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(coordinationReasonCodeSchema).min(1).max(5),
  monitoringPlan: z.object({
    watchFlags: z.array(coordinatorWatchFlagSchema).max(6),
    maxRetries: z.union([z.literal(0), z.literal(1)]),
    fallbackRouteId: routeIdSchema,
  }).strict(),
  ttlMs: z.number().int().min(250).max(15_000),
}).strict();

export interface RouterPromptInput {
  contractId: string;
  contract: CoordinationContract;
  taskSummary: string;
  userVisibleIntent: string;
  inputStats: {
    textLength: number;
    estimatedPromptTokens: number;
    hasImages: boolean;
    hasLinks: boolean;
    hasCode: boolean;
    hasSensitiveLocalData: boolean;
  };
  runtimeHealth: {
    batterySaver: boolean;
    thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
    sustainedLatencyMs: number | null;
    storageAvailableGiB: number | null;
  };
}

export interface CoordinatorPromptInput {
  contractId: string;
  contract: CoordinationContract;
  selectedRouteId: string;
  recentExecution?: {
    status: 'not_started' | 'succeeded' | 'failed' | 'timed_out' | 'quality_below_threshold';
    qualityScore: number | null;
    latencyMs: number | null;
    errorKind?: 'none' | 'model_error' | 'timeout' | 'policy_violation' | 'unknown';
  };
  runtimeHealth: RouterPromptInput['runtimeHealth'];
}

export type RouterPromptOutput = z.infer<typeof routerPromptOutputSchema>;
export type CoordinatorPromptOutput = z.infer<typeof coordinatorPromptOutputSchema>;

export function parseRouterPromptOutput(value: unknown): RouterPromptOutput {
  return routerPromptOutputSchema.parse(value);
}

export function parseCoordinatorPromptOutput(value: unknown): CoordinatorPromptOutput {
  return coordinatorPromptOutputSchema.parse(value);
}
