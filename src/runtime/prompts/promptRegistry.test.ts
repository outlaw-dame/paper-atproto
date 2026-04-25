import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  coordinatorPromptOutputJsonSchema,
  routerPromptOutputJsonSchema,
} from './promptJsonSchemas';
import {
  COORDINATOR_PROMPT_ID,
  COORDINATOR_PROMPT_VERSION,
  ROUTER_PROMPT_ID,
  ROUTER_PROMPT_VERSION,
  coordinatorPromptOutputSchema,
  routerPromptOutputSchema,
} from './promptSchemas';
import { runtimePromptRegistry } from './promptRegistry';

const routerFixture = {
  schemaVersion: 1,
  promptId: ROUTER_PROMPT_ID,
  promptVersion: ROUTER_PROMPT_VERSION,
  contractId: 'contract:test',
  decisionType: 'route',
  selectedRouteId: 'model:qwen3_4b',
  confidence: 0.91,
  reasonCodes: ['policy_selected_primary'],
  ttlMs: 1_000,
};

const coordinatorFixture = {
  schemaVersion: 1,
  promptId: COORDINATOR_PROMPT_ID,
  promptVersion: COORDINATOR_PROMPT_VERSION,
  contractId: 'contract:test',
  recommendation: 'accept_route',
  selectedRouteId: 'model:qwen3_4b',
  confidence: 0.86,
  reasonCodes: ['policy_selected_primary'],
  monitoringPlan: {
    watchFlags: ['low_confidence'],
    maxRetries: 1,
    fallbackRouteId: 'model:smollm3_3b',
  },
  ttlMs: 1_000,
};

describe('runtime prompt registry', () => {
  it('registers versioned router and coordinator prompts', () => {
    expect(runtimePromptRegistry.router.id).toBe(ROUTER_PROMPT_ID);
    expect(runtimePromptRegistry.router.version).toBe(ROUTER_PROMPT_VERSION);
    expect(runtimePromptRegistry.router.role).toBe('router');
    expect(runtimePromptRegistry.router.temperature).toBe(0);

    expect(runtimePromptRegistry.coordinator.id).toBe(COORDINATOR_PROMPT_ID);
    expect(runtimePromptRegistry.coordinator.version).toBe(COORDINATOR_PROMPT_VERSION);
    expect(runtimePromptRegistry.coordinator.role).toBe('coordinator');
    expect(runtimePromptRegistry.coordinator.temperature).toBe(0);
  });

  it('keeps router and coordinator prompts focused on their distinct jobs', () => {
    expect(runtimePromptRegistry.router.system).toContain('best valid execution path');
    expect(runtimePromptRegistry.router.system).toContain('Do not drift');
    expect(runtimePromptRegistry.router.system).toContain('Do not expose');
    expect(runtimePromptRegistry.router.system).toContain('Output only the required structured JSON object');

    expect(runtimePromptRegistry.coordinator.system).toContain('functioning correctly');
    expect(runtimePromptRegistry.coordinator.system).toContain('each part is executing its job');
    expect(runtimePromptRegistry.coordinator.system).toContain('Do not drift');
    expect(runtimePromptRegistry.coordinator.system).toContain('Output only the required structured JSON object');
  });

  it('accepts valid structured router and coordinator outputs', () => {
    expect(routerPromptOutputSchema.parse(routerFixture)).toEqual(routerFixture);
    expect(coordinatorPromptOutputSchema.parse(coordinatorFixture)).toEqual(coordinatorFixture);
  });

  it('exposes portable JSON Schema contracts for model boundaries', () => {
    expect(runtimePromptRegistry.router.outputJsonSchema).toBe(routerPromptOutputJsonSchema);
    expect(runtimePromptRegistry.coordinator.outputJsonSchema).toBe(coordinatorPromptOutputJsonSchema);
    expect(routerPromptOutputJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'schemaVersion',
        'promptId',
        'promptVersion',
        'contractId',
        'decisionType',
        'selectedRouteId',
        'confidence',
        'reasonCodes',
        'ttlMs',
      ]),
    });
    expect(coordinatorPromptOutputJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'schemaVersion',
        'promptId',
        'promptVersion',
        'contractId',
        'recommendation',
        'selectedRouteId',
        'confidence',
        'reasonCodes',
        'monitoringPlan',
        'ttlMs',
      ]),
    });
    expect(() => JSON.stringify(routerPromptOutputJsonSchema)).not.toThrow();
    expect(() => JSON.stringify(coordinatorPromptOutputJsonSchema)).not.toThrow();
  });

  it('rejects random strings, extra fields, and invalid reason codes', () => {
    expect(() => routerPromptOutputSchema.parse('random')).toThrow(z.ZodError);
    expect(() => routerPromptOutputSchema.parse({ ...routerFixture, extra: 'not-allowed' })).toThrow(z.ZodError);
    expect(() => routerPromptOutputSchema.parse({ ...routerFixture, reasonCodes: ['random_string'] })).toThrow(z.ZodError);

    expect(() => coordinatorPromptOutputSchema.parse('random')).toThrow(z.ZodError);
    expect(() => coordinatorPromptOutputSchema.parse({ ...coordinatorFixture, extra: 'not-allowed' })).toThrow(z.ZodError);
    expect(() => coordinatorPromptOutputSchema.parse({ ...coordinatorFixture, monitoringPlan: { ...coordinatorFixture.monitoringPlan, maxRetries: 2 } })).toThrow(z.ZodError);
  });

  it('requires prompt identity and version fields', () => {
    expect(() => routerPromptOutputSchema.parse({ ...routerFixture, promptId: COORDINATOR_PROMPT_ID })).toThrow(z.ZodError);
    expect(() => routerPromptOutputSchema.parse({ ...routerFixture, promptVersion: ROUTER_PROMPT_VERSION + 1 })).toThrow(z.ZodError);

    expect(() => coordinatorPromptOutputSchema.parse({ ...coordinatorFixture, promptId: ROUTER_PROMPT_ID })).toThrow(z.ZodError);
    expect(() => coordinatorPromptOutputSchema.parse({ ...coordinatorFixture, promptVersion: COORDINATOR_PROMPT_VERSION + 1 })).toThrow(z.ZodError);
  });
});
