import { describe, expect, it } from 'vitest';
import { normalizeExternalFeedUrl } from './feedUrls';

describe('normalizeExternalFeedUrl', () => {
  it('normalizes safe http and https feed urls', () => {
    expect(
      normalizeExternalFeedUrl(' https://example.com/feed.xml#section '),
    ).toBe('https://example.com/feed.xml');
  });

  it('rejects unsupported protocols, credentials, and malformed input', () => {
    expect(normalizeExternalFeedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeExternalFeedUrl('https://user:pass@example.com/feed.xml')).toBeNull();
    expect(normalizeExternalFeedUrl('not a url')).toBeNull();
    expect(normalizeExternalFeedUrl('')).toBeNull();
  });

  it('strips control characters and enforces a bounded length', () => {
    expect(
      normalizeExternalFeedUrl('https://example.com/\u0000feed.xml'),
    ).toBe('https://example.com/feed.xml');
    expect(
      normalizeExternalFeedUrl(`https://example.com/${'x'.repeat(3000)}`),
    ).toBeNull();
  });
});
