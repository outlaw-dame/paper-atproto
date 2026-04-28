import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readViewScrollPosition, writeViewScrollPosition } from './viewResume';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('view resume persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    localStorage.clear();
  });

  it('stores and restores per-view scroll top values', () => {
    writeViewScrollPosition('explore:did:plc:user', 418.7);
    expect(readViewScrollPosition('explore:did:plc:user')).toBe(418);
    expect(readViewScrollPosition('profile:did:plc:user')).toBe(0);
  });

  it('ignores stale entries outside retention window', () => {
    writeViewScrollPosition('activity:did:plc:user', 240);
    vi.advanceTimersByTime(1000 * 60 * 60 * 24 * 15);
    expect(readViewScrollPosition('activity:did:plc:user')).toBe(0);
  });

  it('stores floored positions deterministically across repeated writes', () => {
    writeViewScrollPosition('profile:did:plc:user', 100.9);
    writeViewScrollPosition('profile:did:plc:user', 100.2);
    expect(readViewScrollPosition('profile:did:plc:user')).toBe(100);
  });
});
