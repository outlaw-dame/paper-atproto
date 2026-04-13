import { beforeEach, describe, expect, it } from 'vitest';

import {
  getPremiumDiagnostics,
  recordPremiumProviderModelAttempt,
  recordPremiumProviderModelFailure,
  recordPremiumProviderModelSuccess,
  recordPremiumProviderAttempt,
  recordPremiumProviderFailover,
  recordPremiumProviderFailure,
  recordPremiumProviderSuccess,
  recordPremiumRouteFailure,
  recordPremiumRouteInvocation,
  recordPremiumRouteSafetyFilter,
  recordPremiumRouteSuccess,
  resetPremiumDiagnostics,
} from './premiumDiagnostics.js';

describe('premiumDiagnostics', () => {
  beforeEach(() => {
    resetPremiumDiagnostics();
  });

  it('records premium quality rejects, failovers, and route safety telemetry', () => {
    recordPremiumRouteInvocation();

    recordPremiumProviderAttempt({
      provider: 'openai',
      attemptKind: 'primary',
    });
    recordPremiumProviderModelAttempt({
      provider: 'openai',
      model: 'gpt-5.4',
    });
    recordPremiumProviderModelFailure({
      provider: 'openai',
      model: 'gpt-5.4',
    });
    recordPremiumProviderFailure({
      provider: 'openai',
      attemptKind: 'primary',
      latencyMs: 181,
      requestId: 'req-premium-1',
      error: Object.assign(
        new Error('Deep interpolator returned a non-additive summary'),
        {
          status: 502,
          code: 'deep_interpolator_non_additive_output',
        },
      ),
    });
    recordPremiumProviderFailover({
      fromProvider: 'openai',
      toProvider: 'gemini',
    });

    recordPremiumProviderAttempt({
      provider: 'gemini',
      attemptKind: 'fallback',
    });
    recordPremiumProviderModelAttempt({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    recordPremiumProviderModelSuccess({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    recordPremiumProviderSuccess({
      provider: 'gemini',
      attemptKind: 'fallback',
      latencyMs: 124,
    });

    recordPremiumRouteSafetyFilter({
      mutated: true,
      blocked: false,
    });
    recordPremiumRouteSuccess();

    const diagnostics = getPremiumDiagnostics() as {
      route?: {
        invocations?: number;
        successes?: number;
        failovers?: { attempted?: number; succeeded?: number; failed?: number };
        safetyFilter?: { mutated?: number; blocked?: number };
        qualityRejects?: { nonAdditive?: number; total?: number };
      };
      providers?: Record<string, {
        attempts?: number;
        fallbackAttempts?: number;
        successes?: number;
        failures?: number;
        lastModel?: string | null;
        failoversFrom?: number;
        failoversTo?: number;
        qualityRejects?: { nonAdditive?: number; total?: number };
        models?: Record<string, {
          attempts?: number;
          successes?: number;
          failures?: number;
          successRate?: number;
          failureRate?: number;
          lastUsedAt?: string | null;
        }>;
      }>;
      lastFailure?: {
        provider?: string;
        attemptKind?: string;
        failureClass?: string;
        code?: string;
        requestId?: string;
      };
    };

    expect(diagnostics.route?.invocations).toBe(1);
    expect(diagnostics.route?.successes).toBe(1);
    expect(diagnostics.route?.failovers?.attempted).toBe(1);
    expect(diagnostics.route?.failovers?.succeeded).toBe(1);
    expect(diagnostics.route?.failovers?.failed).toBe(0);
    expect(diagnostics.route?.safetyFilter?.mutated).toBe(1);
    expect(diagnostics.route?.safetyFilter?.blocked).toBe(0);
    expect(diagnostics.route?.qualityRejects?.nonAdditive).toBe(1);
    expect(diagnostics.route?.qualityRejects?.total).toBe(1);
    expect(diagnostics.providers?.openai?.attempts).toBe(1);
    expect(diagnostics.providers?.openai?.failures).toBe(1);
    expect(diagnostics.providers?.openai?.failoversFrom).toBe(1);
    expect(diagnostics.providers?.openai?.qualityRejects?.nonAdditive).toBe(1);
    expect(diagnostics.providers?.openai?.models?.['gpt-5.4']?.attempts).toBe(1);
    expect(diagnostics.providers?.openai?.models?.['gpt-5.4']?.failures).toBe(1);
    expect(diagnostics.providers?.gemini?.attempts).toBe(1);
    expect(diagnostics.providers?.gemini?.fallbackAttempts).toBe(1);
    expect(diagnostics.providers?.gemini?.successes).toBe(1);
    expect(diagnostics.providers?.gemini?.failoversTo).toBe(1);
    expect(diagnostics.providers?.gemini?.lastModel).toBe('gemini-2.5-flash');
    expect(diagnostics.providers?.gemini?.models?.['gemini-2.5-flash']?.attempts).toBe(1);
    expect(diagnostics.providers?.gemini?.models?.['gemini-2.5-flash']?.successes).toBe(1);
    expect(diagnostics.lastFailure?.provider).toBe('openai');
    expect(diagnostics.lastFailure?.attemptKind).toBe('primary');
    expect(diagnostics.lastFailure?.failureClass).toBe('quality_unavailable');
    expect(diagnostics.lastFailure?.code).toBe('deep_interpolator_non_additive_output');
    expect(diagnostics.lastFailure?.requestId).toBe('req-premium-1');
  });

  it('captures sanitized route failures for premium safety blocks', () => {
    recordPremiumRouteInvocation();
    recordPremiumRouteFailure({
      requestId: 'req-premium-2',
      error: Object.assign(
        new Error('Premium AI output failed safety validation\nwith raw detail'),
        {
          status: 503,
          code: 'premium_ai_safety_blocked',
        },
      ),
    });

    const diagnostics = getPremiumDiagnostics() as {
      route?: { failures?: number };
      lastFailure?: {
        failureClass?: string;
        message?: string;
        requestId?: string;
      };
    };

    expect(diagnostics.route?.failures).toBe(1);
    expect(diagnostics.lastFailure?.failureClass).toBe('safety_blocked');
    expect(diagnostics.lastFailure?.message).toBe('Premium AI output failed safety validation with raw detail');
    expect(diagnostics.lastFailure?.requestId).toBe('req-premium-2');
  });
});
