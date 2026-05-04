import { afterEach, describe, expect, it } from 'vitest';
import {
  executeThinkingPlan,
  type ThinkingPlan,
  type ThinkingStep,
} from './thinkingLane';
import {
  __resetIntelligenceEventsForTesting,
  getIntelligenceEventBufferSnapshot,
} from './intelligenceEvents';

afterEach(() => {
  __resetIntelligenceEventsForTesting();
});

function step<TIn, TOut>(
  id: string,
  kind: ThinkingStep['kind'],
  budgetMs: number,
  run: ThinkingStep<TIn, TOut>['run'],
): ThinkingStep<TIn, TOut> {
  return { id, kind, budgetMs, run };
}

describe('thinkingLane.executeThinkingPlan', () => {
  it('runs steps in order, threads previous results, and produces a final value', async () => {
    const plan: ThinkingPlan<number> = {
      id: 'plan_basic',
      requesterSurface: 'composer',
      totalBudgetMs: 1_000,
      steps: [
        step<unknown, number>('a', 'analyze', 200, () => 1),
        step<number, number>('b', 'extract', 200, ({ previous }) => (previous?.value ?? 0) + 2),
        step<number, number>('c', 'synthesize', 200, ({ previous }) => (previous?.value ?? 0) * 10),
      ],
    };
    const result = await executeThinkingPlan(plan);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(30);
    expect(result.degraded).toBe(false);
    expect(result.budgetExceeded).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.steps.map((s) => s.result.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });

  it('isolates a throwing step and continues with the prior success', async () => {
    const plan: ThinkingPlan<string> = {
      id: 'plan_throws',
      requesterSurface: 'composer',
      totalBudgetMs: 1_000,
      steps: [
        step<unknown, string>('a', 'analyze', 200, () => 'ok'),
        step<string, string>('b', 'extract', 200, () => {
          throw new Error('boom_xyz');
        }),
        step<string, string>('c', 'synthesize', 200, ({ previous }) => `<${previous?.value}>`),
      ],
    };
    const result = await executeThinkingPlan(plan);
    expect(result.steps[1]?.result.status).toBe('errored');
    expect(result.steps[1]?.result.reasonCode).toBe('boom_xyz');
    expect(result.value).toBe('<ok>');
    expect(result.ok).toBe(true);
    expect(result.reasonCodes).toContain('boom_xyz');
  });

  it('honours the verifier and uses the fallback when it rejects with useFallback', async () => {
    const plan: ThinkingPlan<string> = {
      id: 'plan_verifier',
      requesterSurface: 'writer',
      totalBudgetMs: 1_000,
      steps: [step<unknown, string>('a', 'analyze', 100, () => 'weak')],
      verifier: ({ finalValue }) =>
        finalValue === 'weak'
          ? { ok: false, reasonCode: 'too_weak', useFallback: true }
          : { ok: true },
      fallback: () => 'safe_default',
    };
    const result = await executeThinkingPlan(plan);
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.value).toBe('safe_default');
    expect(result.reasonCodes).toContain('too_weak');
    expect(result.reasonCodes).toContain('thinking_fallback_used');
  });

  it('treats a throwing verifier as a fallback-required failure', async () => {
    const plan: ThinkingPlan<string> = {
      id: 'plan_verifier_throws',
      requesterSurface: 'writer',
      totalBudgetMs: 1_000,
      steps: [step<unknown, string>('a', 'analyze', 100, () => 'val')],
      verifier: () => {
        throw new Error('verifier blew up');
      },
      fallback: () => 'safe',
    };
    const result = await executeThinkingPlan(plan);
    expect(result.degraded).toBe(true);
    expect(result.value).toBe('safe');
    expect(result.reasonCodes).toContain('verifier_threw');
  });

  it('skips remaining steps once the total budget is exceeded', async () => {
    const plan: ThinkingPlan<number> = {
      id: 'plan_budget',
      requesterSurface: 'composer',
      totalBudgetMs: 50,
      steps: [
        step<unknown, number>('a', 'analyze', 50, async () => {
          await new Promise((r) => setTimeout(r, 60));
          return 1;
        }),
        step<number, number>('b', 'extract', 50, () => 2),
      ],
    };
    const result = await executeThinkingPlan(plan);
    expect(result.budgetExceeded).toBe(true);
    expect(result.steps[1]?.result.status).toBe('skipped');
    expect(result.reasonCodes).toContain('thinking_budget_exceeded');
  });

  it('aborts cleanly when the external signal fires before execution', async () => {
    const ac = new AbortController();
    ac.abort();
    const plan: ThinkingPlan<number> = {
      id: 'plan_abort',
      requesterSurface: 'media',
      totalBudgetMs: 1_000,
      steps: [step<unknown, number>('a', 'analyze', 100, () => 1)],
    };
    const result = await executeThinkingPlan(plan, { signal: ac.signal });
    expect(result.aborted).toBe(true);
    expect(result.steps[0]?.result.status).toBe('skipped');
    expect(result.reasonCodes).toContain('thinking_aborted');
  });

  it('emits one intelligence_event per step plus a summary event', async () => {
    const plan: ThinkingPlan<number> = {
      id: 'plan_telemetry',
      requesterSurface: 'composer',
      totalBudgetMs: 500,
      sessionId: 'sess-tl-1',
      sourceToken: 'src-tl-1',
      steps: [
        step<unknown, number>('a', 'analyze', 100, () => 1),
        step<number, number>('b', 'verify', 100, () => 2),
      ],
    };
    await executeThinkingPlan(plan);
    const snap = getIntelligenceEventBufferSnapshot();
    const thinkingEvents = snap.events.filter((e) => e.surface === 'thinking');
    // 2 step events + 1 summary event
    expect(thinkingEvents.length).toBe(3);
    expect(thinkingEvents[0]?.sessionId).toBe('sess-tl-1');
    expect(thinkingEvents[0]?.sourceToken).toBe('src-tl-1');
    const summary = thinkingEvents[thinkingEvents.length - 1];
    expect(summary?.details?.steps_total).toBe(2);
    expect(summary?.details?.steps_succeeded).toBe(2);
  });

  it('caps plan steps at the safety maximum', async () => {
    const big: ThinkingStep[] = Array.from({ length: 25 }, (_, i) =>
      step<unknown, number>(`s${i}`, 'analyze', 5, () => i),
    );
    const result = await executeThinkingPlan({
      id: 'plan_big',
      requesterSurface: 'composer',
      totalBudgetMs: 1_000,
      steps: big,
    });
    expect(result.steps.length).toBeLessThanOrEqual(12);
  });

  it('returns ok=false when no step produces a value and there is no fallback', async () => {
    const plan: ThinkingPlan<number> = {
      id: 'plan_empty',
      requesterSurface: 'composer',
      totalBudgetMs: 100,
      steps: [
        step<unknown, number>('a', 'analyze', 50, () => {
          throw new Error('nope');
        }),
      ],
    };
    const result = await executeThinkingPlan(plan);
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it('frozen result cannot be mutated', async () => {
    const result = await executeThinkingPlan({
      id: 'plan_frozen',
      requesterSurface: 'composer',
      totalBudgetMs: 100,
      steps: [step<unknown, number>('a', 'analyze', 50, () => 1)],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(Object.isFrozen(result.steps[0])).toBe(true);
  });
});
