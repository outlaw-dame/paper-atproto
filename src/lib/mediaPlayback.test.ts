import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMediaPlaybackPrefs, saveMediaPlaybackPrefs } from './mediaPlayback';

const STORAGE_KEY = 'paper-atproto.mediaPlayback.v1';

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

describe('mediaPlayback persistence hygiene', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    localStorage.clear();
  });

  it('does not return stale playback preferences older than retention window', () => {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      'media:old': { updatedAt: now - (1000 * 60 * 60 * 24 * 31), positionSeconds: 12 },
    }));

    expect(getMediaPlaybackPrefs('media:old')).toBeNull();
  });

  it('bounds persisted map size to avoid unbounded growth', () => {
    for (let i = 0; i < 600; i += 1) {
      saveMediaPlaybackPrefs(`media:${i}`, { positionSeconds: i, playbackRate: 1 });
      vi.advanceTimersByTime(1);
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(Object.keys(parsed).length).toBeLessThanOrEqual(500);
  });
});
