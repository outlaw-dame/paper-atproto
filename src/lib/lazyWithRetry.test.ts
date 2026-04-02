import { describe, expect, it, vi } from 'vitest';
import {
  isRecoverableLazyChunkError,
  maybeTriggerLazyChunkReload,
} from './lazyWithRetry';

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('lazyWithRetry helpers', () => {
  it('recognizes common stale chunk load errors', () => {
    expect(isRecoverableLazyChunkError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isRecoverableLazyChunkError(new Error('ChunkLoadError: Loading chunk 12 failed.'))).toBe(true);
    expect(isRecoverableLazyChunkError(new Error('Something else broke'))).toBe(false);
  });

  it('triggers at most one reload per label inside the throttle window', () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(40_500);
    const error = new Error('Failed to fetch dynamically imported module');

    expect(maybeTriggerLazyChunkReload('Settings', error, { prod: true, storage, reload, now })).toBe(true);
    expect(maybeTriggerLazyChunkReload('Settings', error, { prod: true, storage, reload, now })).toBe(false);
    expect(maybeTriggerLazyChunkReload('Settings', error, { prod: true, storage, reload, now })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads for non-prod or non-chunk errors', () => {
    const reload = vi.fn();
    expect(maybeTriggerLazyChunkReload('Settings', new Error('Oops'), { prod: true, reload })).toBe(false);
    expect(maybeTriggerLazyChunkReload('Settings', new Error('ChunkLoadError'), { prod: false, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
