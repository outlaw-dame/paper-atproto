import { describe, expect, it } from 'vitest';
import { classifyRuntimeTier, detectBrowserFamily } from './capabilityProbe';

describe('detectBrowserFamily', () => {
  it('recognizes coarse browser families', () => {
    expect(detectBrowserFamily('Mozilla/5.0 Chrome/124.0 Safari/537.36')).toBe('chromium');
    expect(detectBrowserFamily('Mozilla/5.0 Version/17.4 Safari/605.1.15')).toBe('safari');
    expect(detectBrowserFamily('Mozilla/5.0 Firefox/126.0')).toBe('firefox');
  });
});

describe('classifyRuntimeTier', () => {
  it('scores strong chromium devices as high tier', () => {
    expect(classifyRuntimeTier({
      browserFamily: 'chromium',
      deviceMemoryGiB: 16,
      hardwareConcurrency: 12,
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
    })).toBe('high');
  });

  it('keeps weaker devices in the low tier', () => {
    expect(classifyRuntimeTier({
      browserFamily: 'safari',
      deviceMemoryGiB: 2,
      hardwareConcurrency: 2,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    })).toBe('low');
  });
});
