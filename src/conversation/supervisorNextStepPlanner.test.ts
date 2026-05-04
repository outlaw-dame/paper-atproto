import { describe, expect, it } from 'vitest';
import { planSupervisorNextStep } from './supervisorNextStepPlanner';
import type {
  ConversationSupervisorAction,
  ConversationSupervisorStateSummary,
  ConversationSupervisorTraceCode,
} from './supervisorTypes';

function makeSummary(
  overrides: Partial<ConversationSupervisorStateSummary> = {},
): ConversationSupervisorStateSummary {
  return {
    summaryMode: 'normal',
    confidence: null,
    didMeaningfullyChange: false,
    changeMagnitude: 0,
    activeTasks: [],
    errorTasks: [],
    premiumStatus: 'idle',
    multimodalAuthority: 'none',
    hasMutationChurn: false,
    mutationRevision: 1,
    ...overrides,
  };
}

const writerAction: ConversationSupervisorAction = {
  type: 'rerun_writer_with_safe_fallback',
  target: 'writer',
  priority: 'high',
  rationale: 'Writer errored after canonical thread state resolved.',
};

const skipPremiumAction: ConversationSupervisorAction = {
  type: 'skip_premium_for_cycle',
  target: 'premium',
  priority: 'medium',
  rationale: 'Premium failed on a low-signal cycle.',
};

const holdPremiumAction: ConversationSupervisorAction = {
  type: 'hold_premium_until_fresh',
  target: 'premium',
  priority: 'medium',
  rationale: 'Premium running while thread mutates.',
};

const stabilizeAction: ConversationSupervisorAction = {
  type: 'stabilize_composer_context',
  target: 'composer',
  priority: 'medium',
  rationale: 'Mutations are racing active model work.',
};

const lowAuthorityMultimodal: ConversationSupervisorAction = {
  type: 'treat_multimodal_as_low_authority',
  target: 'multimodal',
  priority: 'high',
  rationale: 'Recent media analysis is degraded.',
};

describe('supervisor next-step planner', () => {
  it('picks the highest-priority action and emits clean reason code', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({ premiumStatus: 'loading', hasMutationChurn: true }),
      baseActions: [stabilizeAction, lowAuthorityMultimodal],
      traceCodes: ['mutation_churn', 'multimodal_degraded'],
    });
    expect(r.plan.nextStep?.type).toBe('treat_multimodal_as_low_authority');
    expect(r.plan.holdAll).toBe(false);
    expect(r.plan.reasonCodes).toContain('supervisor_plan_clean');
    expect(r.thinking.ok).toBe(true);
  });

  it('escalates writer rerun above other high-priority actions when writer errored', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({ errorTasks: ['writer'] }),
      baseActions: [lowAuthorityMultimodal, writerAction],
      traceCodes: ['writer_error', 'multimodal_degraded'],
    });
    expect(r.plan.nextStep?.type).toBe('rerun_writer_with_safe_fallback');
    expect(r.plan.reasonCodes).toContain('supervisor_plan_escalate_writer');
  });

  it('prefers skip_premium over hold on a low-signal cycle', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({ premiumStatus: 'error', errorTasks: ['premium'] }),
      baseActions: [holdPremiumAction, skipPremiumAction],
      traceCodes: ['premium_error', 'premium_low_signal_cycle'],
    });
    expect(r.plan.nextStep?.type).toBe('skip_premium_for_cycle');
    expect(r.plan.reasonCodes).toContain('supervisor_plan_escalate_premium_skip');
  });

  it('issues hold_all when multiple errors race mutation churn', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({
        errorTasks: ['writer', 'premium'],
        hasMutationChurn: true,
        premiumStatus: 'error',
      }),
      baseActions: [writerAction, holdPremiumAction],
      traceCodes: ['writer_error', 'premium_error', 'mutation_churn'],
    });
    expect(r.plan.nextStep).toBeNull();
    expect(r.plan.holdAll).toBe(true);
    expect(r.plan.reasonCodes).toContain('supervisor_plan_hold_all');
    // Prioritized list still surfaces for diagnostics.
    expect(r.plan.prioritizedActionTypes.length).toBe(2);
  });

  it('returns no_actions when base set is empty', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary(),
      baseActions: [],
      traceCodes: [],
    });
    expect(r.plan.nextStep).toBeNull();
    expect(r.plan.holdAll).toBe(false);
    expect(r.plan.reasonCodes).toContain('supervisor_plan_no_actions');
  });

  it('deduplicates action types in prioritized list', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({ premiumStatus: 'loading', hasMutationChurn: true }),
      baseActions: [holdPremiumAction, holdPremiumAction, stabilizeAction],
      traceCodes: ['mutation_churn', 'premium_waiting_on_freshness'],
    });
    expect(r.plan.prioritizedActionTypes).toEqual([
      'hold_premium_until_fresh',
      'stabilize_composer_context',
    ]);
  });

  it('sorts by priority rank with stable tie-break on insertion order', async () => {
    // medium priority first, then high — high should bubble to the front.
    const r = await planSupervisorNextStep({
      summary: makeSummary(),
      baseActions: [stabilizeAction, writerAction, holdPremiumAction],
      traceCodes: [],
    });
    expect(r.plan.prioritizedActionTypes[0]).toBe('rerun_writer_with_safe_fallback');
    // Both medium-priority items keep their original order.
    expect(r.plan.prioritizedActionTypes.slice(1)).toEqual([
      'stabilize_composer_context',
      'hold_premium_until_fresh',
    ]);
  });

  it('returns frozen plan and reason codes', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary(),
      baseActions: [writerAction],
      traceCodes: [],
    });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.plan)).toBe(true);
    expect(Object.isFrozen(r.plan.reasonCodes)).toBe(true);
    expect(Object.isFrozen(r.plan.prioritizedActionTypes)).toBe(true);
  });

  it('falls back to a defensible plan when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await planSupervisorNextStep(
      {
        summary: makeSummary(),
        baseActions: [writerAction, stabilizeAction],
        traceCodes: ['writer_error'],
      },
      { signal: controller.signal },
    );
    // Lane fallback yields a defensible "first prioritized action" plan.
    expect(r.plan.nextStep?.type).toBe('rerun_writer_with_safe_fallback');
    expect(r.plan.holdAll).toBe(false);
    expect(r.plan.reasonCodes).toContain('supervisor_plan_unavailable');
  });

  it('never invents action types not present in base actions', async () => {
    const r = await planSupervisorNextStep({
      summary: makeSummary({
        premiumStatus: 'error',
        errorTasks: ['premium'],
      }),
      baseActions: [holdPremiumAction],
      traceCodes: ['premium_error', 'premium_low_signal_cycle'],
    });
    // skip_premium_for_cycle was not in base actions; planner cannot invent it.
    expect(r.plan.nextStep?.type).toBe('hold_premium_until_fresh');
    expect(r.plan.prioritizedActionTypes).toEqual(['hold_premium_until_fresh']);
  });
});
