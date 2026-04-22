import { describe, expect, it } from 'vitest';
import { classifyDiscoveryIntent } from './discoveryIntent';

describe('classifyDiscoveryIntent', () => {
  it('classifies hashtag-led queries with high confidence', () => {
    const intent = classifyDiscoveryIntent('  #atproto   updates  ');
    expect(intent.kind).toBe('hashtag');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    expect(intent.reasons).toContain('hashtag_query');
    expect(intent.normalizedQuery).toBe('#atproto updates');
  });

  it('classifies people intent from handles and profile language', () => {
    expect(classifyDiscoveryIntent('@alice.bsky.social').kind).toBe('people');
    expect(classifyDiscoveryIntent('profiles to follow about ai').kind).toBe('people');
  });

  it('classifies feed/podcast intent before source intent', () => {
    const intent = classifyDiscoveryIntent('best rss podcast feed for security');
    expect(intent.kind).toBe('feed');
    expect(intent.reasons).toContain('feed_signal');
  });

  it('classifies source intent for domain-like queries', () => {
    const intent = classifyDiscoveryIntent('news from example.com');
    expect(intent.kind).toBe('source');
    expect(intent.reasons).toContain('source_signal');
  });

  it('classifies visual intent for image/video phrasing', () => {
    const intent = classifyDiscoveryIntent('find meme screenshot threads');
    expect(intent.kind).toBe('visual');
    expect(intent.queryHasVisualIntent).toBe(true);
  });

  it('sanitizes control characters and falls back to general intent', () => {
    const intent = classifyDiscoveryIntent('  policy\u0000\u0007 watch   now  ');
    expect(intent.normalizedQuery).toBe('policy watch now');
    expect(intent.kind).toBe('general');
  });
});
