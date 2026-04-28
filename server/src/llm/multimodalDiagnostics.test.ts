import { beforeEach, describe, expect, it } from 'vitest';

import {
  getMultimodalDiagnostics,
  recordMultimodalFallback,
  recordMultimodalInvocation,
  recordMultimodalRejection,
  recordMultimodalSuccess,
  resetMultimodalDiagnostics,
} from './multimodalDiagnostics.js';

describe('multimodalDiagnostics', () => {
  beforeEach(() => {
    resetMultimodalDiagnostics();
  });

  it('tracks success, usable-rate, fallbacks, and rejections without storing raw content', () => {
    recordMultimodalInvocation();
    recordMultimodalSuccess({
      mediaType: 'meme',
      moderationAction: 'warn',
      confidence: 0.92,
      latencyMs: 810.9,
    });

    recordMultimodalInvocation();
    recordMultimodalFallback({
      stage: 'model-call',
      latencyMs: 1200.4,
      reason: 'Error',
      message: 'Ollama responded 503 while analyzing https://example.com/private.png',
    });

    recordMultimodalInvocation();
    recordMultimodalRejection({
      stage: 'fetch',
      latencyMs: 140.2,
      reason: 'validation-error',
      message: 'Media URL blocked by Google Safe Browsing.',
    });

    const diagnostics = getMultimodalDiagnostics() as {
      invocations?: number;
      completed?: number;
      successes?: { total?: number; successRate?: number };
      usableResults?: { total?: number; usableRate?: number; threshold?: number };
      fallbacks?: { total?: number; ['model-call']?: number; fallbackRate?: number };
      rejections?: { total?: number };
      mediaTypes?: { meme?: number };
      moderationActions?: { warn?: number };
      confidence?: { average?: number; max?: number; last?: number; usableAverage?: number };
      latencyMs?: { total?: number; max?: number; last?: number; average?: number };
      lastSuccess?: { mediaType?: string; moderationAction?: string; usable?: boolean };
      lastFallback?: { stage?: string; message?: string };
      lastRejection?: { stage?: string; message?: string };
    };

    expect(diagnostics.invocations).toBe(3);
    expect(diagnostics.completed).toBe(3);
    expect(diagnostics.successes?.total).toBe(1);
    expect(diagnostics.successes?.successRate).toBeCloseTo(1 / 3, 5);
    expect(diagnostics.usableResults?.total).toBe(1);
    expect(diagnostics.usableResults?.usableRate).toBeCloseTo(1 / 3, 5);
    expect(diagnostics.usableResults?.threshold).toBe(0.35);
    expect(diagnostics.fallbacks?.total).toBe(1);
    expect(diagnostics.fallbacks?.['model-call']).toBe(1);
    expect(diagnostics.fallbacks?.fallbackRate).toBeCloseTo(1 / 3, 5);
    expect(diagnostics.rejections?.total).toBe(1);
    expect(diagnostics.mediaTypes?.meme).toBe(1);
    expect(diagnostics.moderationActions?.warn).toBe(1);
    expect(diagnostics.confidence?.average).toBe(0.92);
    expect(diagnostics.confidence?.max).toBe(0.92);
    expect(diagnostics.confidence?.last).toBe(0.92);
    expect(diagnostics.confidence?.usableAverage).toBe(0.92);
    expect(diagnostics.latencyMs?.total).toBe(2150);
    expect(diagnostics.latencyMs?.max).toBe(1200);
    expect(diagnostics.latencyMs?.last).toBe(140);
    expect(diagnostics.latencyMs?.average).toBeCloseTo(716.6666, 3);
    expect(diagnostics.lastSuccess?.mediaType).toBe('meme');
    expect(diagnostics.lastSuccess?.moderationAction).toBe('warn');
    expect(diagnostics.lastSuccess?.usable).toBe(true);
    expect(diagnostics.lastFallback?.stage).toBe('model-call');
    expect(diagnostics.lastFallback?.message).not.toContain('https://');
    expect(diagnostics.lastRejection?.stage).toBe('fetch');
    expect(diagnostics.lastRejection?.message).toBe('Media URL blocked by Google Safe Browsing.');
  });
});
