import { describe, expect, it } from 'vitest';
import { buildSessionBrief, SESSION_BRIEF_SCHEMA_VERSION, withFreshness } from './sessionBrief';
import type { RuntimeCapability } from '../../runtime/capabilityProbe';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
};

describe('buildSessionBrief', () => {
  it('fills sane defaults from intent alone', () => {
    const brief = buildSessionBrief({ surface: 'composer', intent: 'composer_writer' });
    expect(brief.schemaVersion).toBe(SESSION_BRIEF_SCHEMA_VERSION);
    expect(brief.scope).toBe('private_draft');
    expect(brief.privacy).toBe('balanced');
    expect(brief.settingsMode).toBe('balanced');
    expect(brief.deviceTier).toBe('mid');
    expect(brief.capability).toBeNull();
    expect(brief.freshness).toEqual({ lastMutationAt: null, sourceToken: null });
    expect(brief.attachments.count).toBe(0);
    expect(brief.runtimeHealth.thermalState).toBe('nominal');
    expect(Object.isFrozen(brief)).toBe(true);
    expect(Object.isFrozen(brief.attachments)).toBe(true);
    expect(Object.isFrozen(brief.freshness)).toBe(true);
  });

  it('derives device tier from capability when not explicitly given', () => {
    const brief = buildSessionBrief({
      surface: 'session',
      intent: 'story_summary',
      capability: HIGH_CAPABILITY,
    });
    expect(brief.deviceTier).toBe('high');
    expect(brief.capability).toBe(HIGH_CAPABILITY);
  });

  it('sanitizes bad input rather than throwing', () => {
    const brief = buildSessionBrief({
      surface: 'discovery',
      intent: 'public_search',
      textLength: -1 as unknown as number,
      estimatedPromptTokens: Number.NaN,
      attachments: { count: -5, hasImages: 'yes' as unknown as boolean },
      freshness: { sourceToken: 'tok\u0000with\u001fctrl', lastMutationAt: '' },
      runtimeHealth: {
        thermalState: 'meltdown' as unknown as 'nominal',
        sustainedLatencyMs: Number.POSITIVE_INFINITY,
      },
      sessionId: 'sess-' + 'x'.repeat(200),
    });
    expect(brief.textLength).toBe(0);
    expect(brief.estimatedPromptTokens).toBe(0);
    expect(brief.attachments.count).toBe(0);
    expect(brief.attachments.hasImages).toBe(false);
    expect(brief.freshness.sourceToken).toBe('tokwithctrl');
    expect(brief.freshness.lastMutationAt).toBeNull();
    expect(brief.runtimeHealth.thermalState).toBe('nominal');
    expect(brief.runtimeHealth.sustainedLatencyMs).toBeNull();
    expect(brief.sessionId && brief.sessionId.length).toBeLessThanOrEqual(64);
  });

  it('public_search defaults to public_corpus scope', () => {
    expect(buildSessionBrief({ surface: 'search', intent: 'public_search' }).scope).toBe('public_corpus');
  });

  it('media_analysis defaults to private_corpus scope', () => {
    expect(buildSessionBrief({ surface: 'media', intent: 'media_analysis' }).scope).toBe('private_corpus');
  });

  it('withFreshness produces a new immutable brief without mutating the original', () => {
    const a = buildSessionBrief({ surface: 'session', intent: 'story_summary' });
    const b = withFreshness(a, { sourceToken: 'src-1' });
    expect(a.freshness.sourceToken).toBeNull();
    expect(b.freshness.sourceToken).toBe('src-1');
    expect(Object.isFrozen(b)).toBe(true);
    expect(b).not.toBe(a);
  });
});
