import { describe, expect, it, vi } from 'vitest';

import { computeBackoffMs } from './entity-linking.provider.js';

describe('entity-linking retry backoff', () => {
  it('applies a non-zero minimum delay floor', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // attempt 0 has cap 250ms; floor should keep delay >= 100ms.
    const delay = computeBackoffMs(0);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(250);
  });

  it('never exceeds per-attempt cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    const delay = computeBackoffMs(4); // cap = min(4000, 250 * 16) => 4000
    expect(delay).toBeLessThanOrEqual(4000);
    expect(delay).toBeGreaterThanOrEqual(100);
  });
});
