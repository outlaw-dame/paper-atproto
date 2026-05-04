import { afterEach, describe, expect, it } from 'vitest';
import {
  __adviseInternalForTesting,
  intelligenceCoordinator,
} from './intelligenceCoordinator';
import { buildSessionBrief } from './sessionBrief';
import {
  __resetIntelligenceEventsForTesting,
  getIntelligenceEventBufferSnapshot,
} from './intelligenceEvents';
import { setFunctionGemmaRouterRuntime } from '../../runtime/routerOrchestrator';
import type { RuntimeCapability } from '../../runtime/capabilityProbe';

const HIGH_CAPABILITY: RuntimeCapability = {
  webgpu: true,
  tier: 'high',
  generationAllowed: true,
  multimodalAllowed: true,
  deviceMemoryGiB: 16,
};

afterEach(() => {
  __resetIntelligenceEventsForTesting();
  setFunctionGemmaRouterRuntime(null);
});

describe('intelligenceCoordinator', () => {
  it('advises the composer surface with deterministic policy by default', async () => {
    const brief = buildSessionBrief({
      surface: 'composer',
      intent: 'composer_writer',
      capability: HIGH_CAPABILITY,
      explicitUserAction: true,
      sessionId: 'sess-1',
      freshness: { sourceToken: 'src-1' },
    });
    const advice = await intelligenceCoordinator.adviseOnComposer(brief, {
      silentRouterAudit: true,
    });
    expect(advice.lane).toBeTruthy();
    expect(advice.deterministicFallback).toBe(true);
    expect(advice.modelCandidates.length).toBeGreaterThan(0);
    expect(advice.event.surface).toBe('composer');
    expect(advice.event.task).toBe('composer_writer');
    expect(advice.event.sourceToken).toBe('src-1');
    expect(advice.event.sessionId).toBe('sess-1');
    expect(advice.reasonCodes.some((r) => r.startsWith('router_status_'))).toBe(true);
  });

  it('produces an edge plan for composer_refine on a balanced session', async () => {
    const brief = buildSessionBrief({
      surface: 'composer',
      intent: 'composer_refine',
      capability: HIGH_CAPABILITY,
      privacy: 'balanced',
    });
    const advice = await intelligenceCoordinator.adviseOnComposer(brief);
    expect(advice.edgePlan?.capability).toBe('composer_classify');
    expect(advice.event.task).toBe('composer_refine');
  });

  it('skips the router for hot-path scoring (search) and still emits an event', async () => {
    const brief = buildSessionBrief({
      surface: 'search',
      intent: 'public_search',
      capability: HIGH_CAPABILITY,
    });
    const advice = await intelligenceCoordinator.adviseOnSearch(brief);
    expect(advice.routerResult).toBeUndefined();
    expect(advice.modelCandidates.length).toBe(0);
    const snap = getIntelligenceEventBufferSnapshot();
    expect(snap.events.find((e) => e.surface === 'search' && e.task === 'public_search')).toBeTruthy();
  });

  it('advise without capability still returns a deterministic-only advice', async () => {
    const brief = buildSessionBrief({
      surface: 'composer',
      intent: 'composer_writer',
    });
    const advice = await intelligenceCoordinator.adviseOnComposer(brief);
    expect(advice.routerResult).toBeUndefined();
    expect(advice.deterministicFallback).toBe(true);
    expect(advice.lane).toBeTruthy();
  });

  it('flags a surface/intent mismatch with a follow-up event but still returns advice', async () => {
    const brief = buildSessionBrief({
      surface: 'composer',
      intent: 'public_search',
      capability: HIGH_CAPABILITY,
    });
    // adviseOnComposer expects composer-* intents. Using public_search should
    // be tagged as a mismatch.
    const advice = await intelligenceCoordinator.adviseOnComposer(brief);
    expect(advice.lane).toBeTruthy();
    const snap = getIntelligenceEventBufferSnapshot();
    expect(
      snap.events.some(
        (e) => e.reasonCodes.includes('surface_intent_mismatch'),
      ),
    ).toBe(true);
  });

  it('emits an event with deterministicFallback=true when the router is unavailable', async () => {
    const brief = buildSessionBrief({
      surface: 'session',
      intent: 'story_summary',
      capability: HIGH_CAPABILITY,
    });
    const advice = await __adviseInternalForTesting(brief, { silentRouterAudit: true });
    expect(advice.event.deterministicFallback).toBe(true);
    expect(advice.routerResult).toBeDefined();
  });
});
