import { describe, expect, it, vi } from 'vitest';
import { getSafeExternalHostname, openExternalUrl, sanitizeExternalUrl } from './externalUrl.js';

describe('externalUrl safety', () => {
  it('accepts http and https urls', () => {
    expect(sanitizeExternalUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(sanitizeExternalUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects dangerous or malformed urls', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalUrl('data:text/html,hello')).toBeNull();
    expect(sanitizeExternalUrl(' https://exa\u0000mple.com ')).toBeNull();
  });

  it('extracts a safe hostname', () => {
    expect(getSafeExternalHostname('https://www.example.com/article')).toBe('example.com');
  });

  it('opens only safe external urls', () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    expect(openExternalUrl('https://example.com')).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');

    expect(openExternalUrl('javascript:alert(1)')).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
