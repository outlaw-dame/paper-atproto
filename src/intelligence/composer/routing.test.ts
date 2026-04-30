import { describe, expect, it } from 'vitest';

import {
  isAutomaticComposerBrowserMlAllowed,
  shouldRunComposerModelStageForDraft,
} from './routing';
import type { ComposerGuidanceResult } from './types';

function guidance(overrides: Partial<ComposerGuidanceResult> = {}): ComposerGuidanceResult {
  return {
    mode: 'post',
    level: 'ok',
    heuristics: {
      label: 'neutral',
      level: 'ok',
      score: 0,
      signals: [],
      constructiveSignals: [],
      supportiveReplySignals: [],
      parentSignals: [],
      hasMentalHealthCrisis: false,
    },
    ml: {},
    scores: {
      positiveSignal: 0,
      negativeSignal: 0,
      supportiveness: 0,
      constructiveness: 0,
      clarifying: 0,
      hostility: 0,
      dismissiveness: 0,
      escalation: 0,
      sentimentPositive: 0,
      sentimentNegative: 0,
      anger: 0,
      trust: 0,
      optimism: 0,
      targetedNegativity: 0,
      toxicity: 0,
    },
    toolsUsed: ['heuristic'],
    abuseScore: null,
    ui: {
      state: 'neutral',
      title: 'Neutral',
      message: 'No guidance needed.',
      badges: [],
      footnote: '',
    },
    ...overrides,
  };
}

describe('composer browser ML routing', () => {
  it('keeps automatic browser ML disabled unless explicitly enabled', () => {
    expect(isAutomaticComposerBrowserMlAllowed({
      automaticBrowserMlEnabled: false,
      deviceMemoryGiB: 16,
      isMobile: false,
    })).toBe(false);

    expect(shouldRunComposerModelStageForDraft(
      'post',
      'This draft is long enough to qualify for model refinement.',
      guidance(),
      { automaticBrowserMlEnabled: false, deviceMemoryGiB: 16, isMobile: false },
    )).toBe(false);
  });

  it('rejects mobile and low-memory automatic browser ML even when the flag is enabled', () => {
    expect(isAutomaticComposerBrowserMlAllowed({
      automaticBrowserMlEnabled: true,
      deviceMemoryGiB: 16,
      isMobile: true,
    })).toBe(false);

    expect(isAutomaticComposerBrowserMlAllowed({
      automaticBrowserMlEnabled: true,
      deviceMemoryGiB: 4,
      isMobile: false,
    })).toBe(false);
  });

  it('allows automatic browser ML only on opted-in high-memory desktop paths', () => {
    expect(isAutomaticComposerBrowserMlAllowed({
      automaticBrowserMlEnabled: true,
      deviceMemoryGiB: 16,
      isMobile: false,
    })).toBe(true);

    expect(shouldRunComposerModelStageForDraft(
      'post',
      'This draft is long enough to qualify for model refinement.',
      guidance(),
      { automaticBrowserMlEnabled: true, deviceMemoryGiB: 16, isMobile: false },
    )).toBe(true);
  });

  it('still blocks model stage for alert and crisis guidance after passing the device gate', () => {
    expect(shouldRunComposerModelStageForDraft(
      'post',
      'This draft is long enough to qualify for model refinement.',
      guidance({ level: 'alert' }),
      { automaticBrowserMlEnabled: true, deviceMemoryGiB: 16, isMobile: false },
    )).toBe(false);

    expect(shouldRunComposerModelStageForDraft(
      'post',
      'This draft is long enough to qualify for model refinement.',
      guidance({
        heuristics: {
          ...guidance().heuristics,
          hasMentalHealthCrisis: true,
        },
      }),
      { automaticBrowserMlEnabled: true, deviceMemoryGiB: 16, isMobile: false },
    )).toBe(false);
  });
});
