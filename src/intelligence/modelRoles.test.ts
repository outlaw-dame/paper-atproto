import { describe, expect, it, vi } from 'vitest';

import { createIntelligenceComponentStatus } from './modelRoles';

describe('createIntelligenceComponentStatus', () => {
  it('defaults reason codes and recommended actions to empty arrays', () => {
    const status = createIntelligenceComponentStatus({
      role: 'coordinator',
      state: 'ready',
      quality: 'unknown',
      updatedAtMs: 123,
    });

    expect(status).toEqual({
      role: 'coordinator',
      state: 'ready',
      quality: 'unknown',
      reasonCodes: [],
      recommendedActions: [],
      updatedAtMs: 123,
    });
  });

  it('deduplicates reason codes and recommended actions while preserving insertion order', () => {
    const status = createIntelligenceComponentStatus({
      role: 'interpolator_writer',
      state: 'degraded',
      quality: 'insufficient',
      reasonCodes: [
        'quality_below_threshold',
        'fallback_available',
        'quality_below_threshold',
      ],
      recommendedActions: [
        'invoke_writer_enhancer',
        'retry_component',
        'invoke_writer_enhancer',
      ],
      updatedAtMs: 456,
    });

    expect(status.reasonCodes).toEqual(['quality_below_threshold', 'fallback_available']);
    expect(status.recommendedActions).toEqual(['invoke_writer_enhancer', 'retry_component']);
  });

  it('uses the current timestamp when updatedAtMs is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(789);

    try {
      expect(createIntelligenceComponentStatus({
        role: 'projection',
        state: 'running',
        quality: 'acceptable',
      }).updatedAtMs).toBe(789);
    } finally {
      vi.useRealTimers();
    }
  });
});
