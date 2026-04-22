import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_PERSISTED_EPISODE_ENTRIES,
  readEpisodeEntries,
  sanitizeEpisodeEntries,
  writeEpisodeEntries,
} from './podcastEpisodeStorage';

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

describe('podcastEpisodeStorage', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
  });

  it('sanitizes entries, drops invalid values, and dedupes by id/link', () => {
    const sanitized = sanitizeEpisodeEntries([
      { id: '1', title: 'A', showTitle: 'Show', link: 'https://example.com/1' },
      { id: '1', title: 'A duplicate', showTitle: 'Show', link: 'https://example.com/1' },
      { id: '', title: 'missing id', showTitle: 'Show', link: 'https://example.com/2' },
      { id: '2', title: 'Bad protocol', showTitle: 'Show', link: 'javascript:alert(1)' },
      { id: '3', title: 'B', showTitle: 'Show', link: 'http://example.com/3' },
    ]);

    expect(sanitized).toEqual([
      { id: '1', title: 'A', showTitle: 'Show', link: 'https://example.com/1', pubDate: undefined },
      { id: '3', title: 'B', showTitle: 'Show', link: 'http://example.com/3', pubDate: undefined },
    ]);
  });

  it('enforces a max persisted entry bound on write/read', () => {
    const key = 'paper-atproto.podcast.saved.v1';
    const many = Array.from({ length: MAX_PERSISTED_EPISODE_ENTRIES + 25 }, (_, index) => ({
      id: `${index}`,
      title: `Episode ${index}`,
      showTitle: 'Show',
      link: `https://example.com/${index}`,
    }));

    writeEpisodeEntries(key, many);
    const loaded = readEpisodeEntries(key);

    expect(loaded.length).toBe(MAX_PERSISTED_EPISODE_ENTRIES);
    expect(loaded[0]?.id).toBe('0');
    expect(loaded[MAX_PERSISTED_EPISODE_ENTRIES - 1]?.id).toBe(`${MAX_PERSISTED_EPISODE_ENTRIES - 1}`);
  });
});