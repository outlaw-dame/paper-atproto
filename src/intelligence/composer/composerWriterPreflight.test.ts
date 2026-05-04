import { describe, expect, it } from 'vitest';
import { evaluateComposerWriterPreflight } from './composerWriterPreflight';
import { createEmptyComposerGuidanceResult } from './guidanceScoring';
import type { ComposerContext, ComposerGuidanceResult } from './types';

function makeContext(overrides: Partial<ComposerContext> = {}): ComposerContext {
  return {
    mode: 'reply',
    draftText: 'idk',
    ...overrides,
  };
}

function makeGuidance(
  state: ComposerGuidanceResult['ui']['state'] = 'caution',
  overrides: Partial<ComposerGuidanceResult> = {},
): ComposerGuidanceResult {
  const guidance = createEmptyComposerGuidanceResult('reply');
  guidance.ui.state = state;
  return { ...guidance, ...overrides };
}

describe('composer writer preflight', () => {
  it('skips writer when caution + no aux signals + short draft', async () => {
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: 'meh' }),
      makeGuidance('caution'),
    );
    expect(result.decision.proceed).toBe(false);
    expect(result.decision.reasonCodes).toContain('caution_low_signal_short_draft');
    expect(result.thinking.ok).toBe(true);
  });

  it('proceeds when premium context is present', async () => {
    const ctx = makeContext({
      summaries: {
        premiumContext: {
          perspectiveGaps: ['gap-a'],
          followUpQuestions: [],
          confidence: 0.6,
        },
      },
    });
    const result = await evaluateComposerWriterPreflight(ctx, makeGuidance('caution'));
    expect(result.decision.proceed).toBe(true);
    expect(result.decision.reasonCodes).toContain('signals_present');
  });

  it('proceeds when parent signals are present', async () => {
    const guidance = makeGuidance('caution');
    guidance.heuristics.parentSignals = ['Parent asks for specifics'];
    const result = await evaluateComposerWriterPreflight(makeContext(), guidance);
    expect(result.decision.proceed).toBe(true);
  });

  it('proceeds for warning state regardless of signal density', async () => {
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: 'x' }),
      makeGuidance('warning'),
    );
    expect(result.decision.proceed).toBe(true);
    expect(result.decision.reasonCodes).toContain('high_severity_state');
  });

  it('proceeds for alert state regardless of signal density', async () => {
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: 'x' }),
      makeGuidance('alert'),
    );
    expect(result.decision.proceed).toBe(true);
    expect(result.decision.reasonCodes).toContain('high_severity_state');
  });

  it('proceeds when draft is long even without aux signals', async () => {
    const longDraft = 'a'.repeat(120);
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: longDraft }),
      makeGuidance('caution'),
    );
    expect(result.decision.proceed).toBe(true);
  });

  it('always proceeds when mental health crisis is detected (safety override)', async () => {
    const guidance = makeGuidance('caution');
    guidance.heuristics.hasMentalHealthCrisis = true;
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: 'short' }),
      guidance,
    );
    expect(result.decision.proceed).toBe(true);
    expect(result.decision.reasonCodes).toContain('safety_override');
  });

  it('returns frozen decisions and reason code arrays', async () => {
    const result = await evaluateComposerWriterPreflight(makeContext(), makeGuidance('caution'));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decision)).toBe(true);
    expect(Object.isFrozen(result.decision.reasonCodes)).toBe(true);
  });

  it('falls back to proceed=true when externally aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await evaluateComposerWriterPreflight(
      makeContext(),
      makeGuidance('caution'),
      { signal: controller.signal },
    );
    // On pre-abort, the lane fallback runs and yields proceed=true.
    expect(result.decision.proceed).toBe(true);
  });

  it('does NOT skip when targetedNegativity is high', async () => {
    const guidance = makeGuidance('caution');
    guidance.scores.targetedNegativity = 0.5;
    const result = await evaluateComposerWriterPreflight(
      makeContext({ draftText: 'short' }),
      guidance,
    );
    expect(result.decision.proceed).toBe(true);
  });
});
