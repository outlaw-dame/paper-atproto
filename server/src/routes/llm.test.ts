import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    LLM_ENABLED: true,
    NODE_ENV: 'test',
    AI_SESSION_TELEMETRY_ADMIN_SECRET: undefined as string | undefined,
  },
}));

const runInterpolatorWriterMock = vi.hoisted(() => vi.fn());
const runMediaAnalyzerMock = vi.hoisted(() => vi.fn());
const runComposerGuidanceWriterMock = vi.hoisted(() => vi.fn());

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

vi.mock('../services/qwenWriter.js', () => ({
  runInterpolatorWriter: runInterpolatorWriterMock,
}));

vi.mock('../services/qwenMultimodal.js', () => ({
  runMediaAnalyzer: runMediaAnalyzerMock,
}));

vi.mock('../services/qwenComposerGuidanceWriter.js', () => ({
  runComposerGuidanceWriter: runComposerGuidanceWriterMock,
}));

vi.mock('../services/safetyFilters.js', () => ({
  filterWriterResponse: (value: unknown) => ({ filtered: value, safetyMetadata: { passed: true } }),
  filterMediaAnalyzerResponse: (value: unknown) => ({ filtered: value, safetyMetadata: { passed: true } }),
  filterComposerGuidanceResponse: (value: unknown) => ({ filtered: value, safetyMetadata: { passed: true } }),
  logSafetyFlag: vi.fn(),
}));

vi.mock('../services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: vi.fn(async () => ({ blocked: false })),
  shouldBlockSafeBrowsingVerdict: vi.fn(() => false),
}));

vi.mock('../lib/sanitize.js', () => ({
  sanitizeRemoteProcessingUrl: (value: string) => value,
}));

function interpolatorPayload() {
  return {
    threadId: 'thread-1',
    summaryMode: 'normal',
    confidence: {
      surfaceConfidence: 0.9,
      entityConfidence: 0.9,
      interpretiveConfidence: 0.9,
    },
    rootPost: {
      uri: 'at://root/1',
      handle: 'root-handle',
      text: 'Root text',
      createdAt: new Date().toISOString(),
    },
    selectedComments: [],
    topContributors: [],
    safeEntities: [],
    factualHighlights: [],
    whatChangedSignals: [],
  };
}

describe('llm router hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    envMock.LLM_ENABLED = true;
    envMock.NODE_ENV = 'test';
    envMock.AI_SESSION_TELEMETRY_ADMIN_SECRET = undefined;
    runInterpolatorWriterMock.mockReset();
    runMediaAnalyzerMock.mockReset();
    runComposerGuidanceWriterMock.mockReset();
  });

  it('sets and echoes request id when provided by caller', async () => {
    runInterpolatorWriterMock.mockResolvedValue({
      collapsedSummary: 'ok',
      whatChanged: [],
      contributorBlurbs: [],
      abstained: false,
      mode: 'normal',
    });

    const { llmRouter } = await import('./llm.js');

    const response = await llmRouter.request('/write/interpolator', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-test-123',
      },
      body: JSON.stringify(interpolatorPayload()),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-test-123');
  });

  it('opens circuit after repeated upstream failures and returns CIRCUIT_OPEN', async () => {
    runInterpolatorWriterMock.mockRejectedValue(new Error('Ollama responded 503'));

    const { llmRouter } = await import('./llm.js');

    const attempt = async () => llmRouter.request('/write/interpolator', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(interpolatorPayload()),
    });

    const first = await attempt();
    const second = await attempt();
    const third = await attempt();
    const fourth = await attempt();
    const fifth = await attempt();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(fourth.status).toBe(200);

    expect(fifth.status).toBe(503);
    const body = await fifth.json() as { code?: string };
    expect(body.code).toBe('CIRCUIT_OPEN');
    expect(fifth.headers.get('retry-after')).toBeTruthy();

    expect(runInterpolatorWriterMock).toHaveBeenCalledTimes(4);
  });

  it('records writer-outcome telemetry and exposes admin diagnostics', async () => {
    const { llmRouter } = await import('./llm.js');

    const telemetryResponse = await llmRouter.request('/telemetry/writer-outcome', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        outcome: 'fallback',
        reason: 'root-only-response-fallback',
        telemetry: {
          attempted: 5,
          succeeded: 2,
          abstained: 2,
          failed: 1,
        },
      }),
    });

    expect(telemetryResponse.status).toBe(204);

    const diagnosticsResponse = await llmRouter.request('/admin/diagnostics', {
      method: 'GET',
    });
    expect(diagnosticsResponse.status).toBe(200);

    const diagnostics = await diagnosticsResponse.json() as {
      writer?: {
        clientOutcomes?: { fallback?: number };
        fallbackReasonDistribution?: { ['root-only-response-fallback']?: number };
      };
    };

    expect(diagnostics.writer?.clientOutcomes?.fallback).toBeGreaterThanOrEqual(1);
    expect(diagnostics.writer?.fallbackReasonDistribution?.['root-only-response-fallback']).toBeGreaterThanOrEqual(1);
  });

  it('blocks production diagnostics without admin secret', async () => {
    envMock.NODE_ENV = 'production';
    envMock.AI_SESSION_TELEMETRY_ADMIN_SECRET = 'super-secret';
    const { llmRouter } = await import('./llm.js');

    const response = await llmRouter.request('/admin/diagnostics', {
      method: 'GET',
    });

    expect(response.status).toBe(403);
  });

  it('allows production diagnostics with admin secret', async () => {
    envMock.NODE_ENV = 'production';
    envMock.AI_SESSION_TELEMETRY_ADMIN_SECRET = 'super-secret';
    const { llmRouter } = await import('./llm.js');

    const response = await llmRouter.request('/admin/diagnostics', {
      method: 'GET',
      headers: {
        'X-AI-Telemetry-Admin-Secret': 'super-secret',
      },
    });

    expect(response.status).toBe(200);
  });
});
