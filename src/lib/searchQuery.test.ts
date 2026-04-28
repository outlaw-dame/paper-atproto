import { describe, expect, it } from 'vitest';
import { normalizeAtprotoSearchQuery } from './searchQuery';

describe('normalizeAtprotoSearchQuery', () => {
  it('returns empty string for blank input', () => {
    expect(normalizeAtprotoSearchQuery('')).toBe('');
    expect(normalizeAtprotoSearchQuery('   ')).toBe('');
  });

  it('keeps plain keyword queries unchanged (trimmed)', () => {
    expect(normalizeAtprotoSearchQuery('Apple')).toBe('Apple');
    expect(normalizeAtprotoSearchQuery('  Apple  ')).toBe('Apple');
  });

  it('normalizes hashtag queries to plain terms', () => {
    expect(normalizeAtprotoSearchQuery('#Apple')).toBe('Apple');
    expect(normalizeAtprotoSearchQuery('  #Apple  ')).toBe('Apple');
    expect(normalizeAtprotoSearchQuery('#apple')).toBe('apple');
  });

  it('falls back to raw when hashtag-only input would become empty', () => {
    expect(normalizeAtprotoSearchQuery('#')).toBe('#');
  });
});
