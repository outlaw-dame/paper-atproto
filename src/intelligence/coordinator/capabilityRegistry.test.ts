import { describe, expect, it } from 'vitest';
import {
  getTaskCapability,
  isEdgeCapabilityEligibleForTask,
  isLaneEligibleForTask,
  isModelEligibleForTask,
  listTaskCapabilities,
} from './capabilityRegistry';
import type { IntelligenceTask } from '../intelligenceRoutingPolicy';

const ALL_TASKS: ReadonlyArray<IntelligenceTask> = [
  'composer_instant',
  'composer_refine',
  'composer_writer',
  'local_search',
  'public_search',
  'media_analysis',
  'story_summary',
];

describe('capabilityRegistry', () => {
  it('covers every IntelligenceTask', () => {
    const ids = listTaskCapabilities().map((c) => c.task);
    expect([...ids].sort()).toEqual([...ALL_TASKS].sort());
  });

  it('every entry has at least one eligible lane and finite weights', () => {
    for (const cap of listTaskCapabilities()) {
      expect(cap.eligibleLanes.length).toBeGreaterThan(0);
      for (const w of [cap.weights.cost, cap.weights.latency, cap.weights.privacy, cap.weights.quality]) {
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(cap.maxOffDevicePayloadChars).toBeGreaterThanOrEqual(0);
    }
  });

  it('composer_instant is browser_heuristic only and never sends off device', () => {
    const cap = getTaskCapability('composer_instant');
    expect(cap.eligibleLanes).toEqual(['browser_heuristic']);
    expect(cap.eligibleModels.length).toBe(0);
    expect(cap.eligibleEdgeCapabilities.length).toBe(0);
    expect(cap.maxOffDevicePayloadChars).toBe(0);
  });

  it('media_analysis requires grounding and only routes to known multimodal models', () => {
    const cap = getTaskCapability('media_analysis');
    expect(cap.grounding).toBe('required');
    for (const m of cap.eligibleModels) {
      expect(['qwen35_2b_mm', 'qwen35_08b_mm', 'qwen3_vl_4b']).toContain(m);
    }
    expect(cap.eligibleEdgeCapabilities).toEqual(['media_classify']);
  });

  it('lane / model / edge eligibility helpers reject unknown bindings', () => {
    expect(isLaneEligibleForTask('composer_instant', 'edge_classifier')).toBe(false);
    expect(isLaneEligibleForTask('composer_refine', 'edge_classifier')).toBe(true);
    expect(isModelEligibleForTask('local_search', 'qwen3_4b')).toBe(false);
    expect(isModelEligibleForTask('composer_writer', 'qwen3_4b')).toBe(true);
    expect(isEdgeCapabilityEligibleForTask('public_search', 'media_classify')).toBe(false);
    expect(isEdgeCapabilityEligibleForTask('public_search', 'search_rerank')).toBe(true);
  });

  it('returned descriptors are immutable', () => {
    const cap = getTaskCapability('composer_writer');
    expect(Object.isFrozen(cap)).toBe(true);
    expect(Object.isFrozen(cap.eligibleLanes)).toBe(true);
    expect(Object.isFrozen(cap.weights)).toBe(true);
  });
});
