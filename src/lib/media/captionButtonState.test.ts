import { describe, expect, it } from 'vitest';
import { getCaptionButtonState } from './captionButtonState';

describe('getCaptionButtonState', () => {
  it('idle with no captions → Generate Captions, enabled, remove hidden', () => {
    const s = getCaptionButtonState(false, 0);
    expect(s.label).toBe('Generate Captions');
    expect(s.disabled).toBe(false);
    expect(s.showRemove).toBe(false);
  });

  it('idle with existing captions → Regenerate Captions, enabled, remove visible', () => {
    const s = getCaptionButtonState(false, 2);
    expect(s.label).toBe('Regenerate Captions');
    expect(s.disabled).toBe(false);
    expect(s.showRemove).toBe(true);
  });

  it('generating, no prior captions → Generating Captions…, disabled, remove hidden', () => {
    const s = getCaptionButtonState(true, 0);
    expect(s.label).toBe('Generating Captions…');
    expect(s.disabled).toBe(true);
    expect(s.showRemove).toBe(false);
  });

  it('generating with prior captions → disabled, remove hidden (guards double-click)', () => {
    const s = getCaptionButtonState(true, 1);
    expect(s.disabled).toBe(true);
    expect(s.showRemove).toBe(false);
  });

  it('undefined captionCount treated as zero', () => {
    const s = getCaptionButtonState(false);
    expect(s.label).toBe('Generate Captions');
    expect(s.showRemove).toBe(false);
  });
});
