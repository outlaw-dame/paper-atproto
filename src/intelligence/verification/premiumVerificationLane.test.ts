import { describe, expect, it } from 'vitest';
import { verifyPremiumDeepInterpolatorResult } from './premiumVerificationLane';
import type {
  DeepInterpolatorResult,
  PremiumInterpolatorRequest,
} from '../premiumContracts';

function makeRequest(
  overrides: Partial<PremiumInterpolatorRequest> = {},
): PremiumInterpolatorRequest {
  return {
    actorDid: 'did:plc:tester',
    interpretiveBrief: {
      summaryMode: 'normal',
      supports: [],
      limits: [],
    },
    ...overrides,
  } as PremiumInterpolatorRequest;
}

function makeResult(
  overrides: Partial<DeepInterpolatorResult> = {},
): DeepInterpolatorResult {
  return {
    summary: 'A reasonably detailed summary that explains the conversation trajectory thoroughly.',
    perspectiveGaps: ['gap-a', 'gap-b'],
    followUpQuestions: ['q-a'],
    confidence: 0.8,
    provider: 'gemini' as DeepInterpolatorResult['provider'],
    updatedAt: new Date('2026-05-03T00:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('premium verification lane', () => {
  it('returns verified for a healthy result', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(makeResult(), makeRequest());
    expect(r.verdict.trust).toBe('verified');
    expect(r.verdict.holdPremiumUntilFresh).toBe(false);
    expect(r.verdict.suggestedConfidenceCap).toBeCloseTo(0.8, 5);
    expect(r.verdict.reasonCodes).toContain('premium_verification_clean');
    expect(r.thinking.ok).toBe(true);
  });

  it('flags low confidence when summary is too thin against high stated confidence', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({ summary: 'short', confidence: 0.9 }),
      makeRequest(),
    );
    expect(r.verdict.trust).not.toBe('verified');
    expect(r.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.55);
    expect(r.verdict.reasonCodes).toContain('premium_verification_summary_too_thin');
  });

  it('flags no-substantive-signals when high confidence has no gaps/follow-ups/grounding', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({
        confidence: 0.85,
        perspectiveGaps: [],
        followUpQuestions: [],
        groundedContext: undefined,
      }),
      makeRequest(),
    );
    expect(r.verdict.reasonCodes).toContain('premium_verification_no_substantive_signals');
    expect(r.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.6);
  });

  it('flags duplicate signals as low confidence', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({
        perspectiveGaps: ['same gap', 'Same Gap', 'same   gap'],
        followUpQuestions: ['q', 'q'],
      }),
      makeRequest(),
    );
    expect(r.verdict.reasonCodes).toContain('premium_verification_duplicate_signals');
    expect(r.verdict.trust).toBe('low_confidence');
    expect(r.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.7);
  });

  it('flags glossed limits when request had limits but result returned no follow-ups/gaps', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({ perspectiveGaps: [], followUpQuestions: [] }),
      makeRequest({
        interpretiveBrief: {
          summaryMode: 'normal',
          supports: [],
          limits: ['Sample size limited to recent posts'],
        },
      }),
    );
    expect(r.verdict.reasonCodes).toContain('premium_verification_glossed_limits');
  });

  it('forces hold + heavy cap when safety is flagged', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({
        confidence: 0.9,
        safety: { flagged: true, severity: 'high', categories: [] },
      }),
      makeRequest(),
    );
    expect(r.verdict.trust).toBe('hold_until_fresh');
    expect(r.verdict.holdPremiumUntilFresh).toBe(true);
    expect(r.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.4);
    expect(r.verdict.reasonCodes).toContain('premium_verification_safety_flagged');
  });

  it('never raises confidence above the original input', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({ confidence: 0.4 }),
      makeRequest(),
    );
    expect(r.verdict.suggestedConfidenceCap).toBeLessThanOrEqual(0.4);
  });

  it('returns frozen verdict + reason codes', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(makeResult(), makeRequest());
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.verdict)).toBe(true);
    expect(Object.isFrozen(r.verdict.reasonCodes)).toBe(true);
  });

  it('falls back to unverified on pre-aborted signal (preserves caller behaviour)', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({ confidence: 0.72 }),
      makeRequest(),
      { signal: controller.signal },
    );
    expect(r.verdict.trust).toBe('unverified');
    expect(r.verdict.suggestedConfidenceCap).toBeCloseTo(0.72, 5);
    expect(r.verdict.holdPremiumUntilFresh).toBe(false);
  });

  it('clamps non-finite confidence to 0', async () => {
    const r = await verifyPremiumDeepInterpolatorResult(
      makeResult({ confidence: Number.NaN }),
      makeRequest(),
    );
    expect(r.verdict.suggestedConfidenceCap).toBe(0);
  });
});
