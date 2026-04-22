import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_FAVORITE_HASHTAGS,
  normalizeStoredHashtag,
  readStoredHashtags,
  sanitizeStoredHashtags,
} from './hashtagStorage';

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

describe('hashtagStorage', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('normalizes hashtag values consistently', () => {
    expect(normalizeStoredHashtag('#AI ')).toBe('ai');
    expect(normalizeStoredHashtag('  TeCh ')).toBe('tech');
  });

  it('sanitizes, dedupes, and bounds hashtag arrays', () => {
    const overlong = `#${'a'.repeat(200)}`;
    const sanitized = sanitizeStoredHashtags([
      '#AI',
      'ai',
      ' Tech ',
      42,
      '',
      overlong,
      '#news',
    ], 2);

    expect(sanitized).toEqual(['ai', 'tech']);
  });

  it('reads from localStorage using sanitized bounded output', () => {
    const key = 'paper.compose.favoriteHashtags';
    const many = Array.from({ length: MAX_FAVORITE_HASHTAGS + 30 }, (_, index) => `Tag${index}`);
    localStorage.setItem(key, JSON.stringify(many));

    const loaded = readStoredHashtags(key, MAX_FAVORITE_HASHTAGS);

    expect(loaded.length).toBe(MAX_FAVORITE_HASHTAGS);
    expect(loaded[0]).toBe('tag0');
    expect(loaded[MAX_FAVORITE_HASHTAGS - 1]).toBe(`tag${MAX_FAVORITE_HASHTAGS - 1}`);
  });
});