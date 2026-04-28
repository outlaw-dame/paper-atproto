import { describe, expect, it, vi } from 'vitest';

vi.mock('./urlSafety', () => ({
  checkUrlSafety: vi.fn(async (url: string) => ({
    url,
    checked: true,
    status: 'safe',
    safe: true,
    blocked: false,
    threats: [],
  })),
}));

import {
  getSafeExternalHostname,
  openExternalUrl,
  sanitizeExternalUrl,
  sanitizeUrlForProcessing,
} from './externalUrl';
import { checkUrlSafety } from './urlSafety';

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

  it('strips tracking params for remote-processing flows', () => {
    expect(
      sanitizeUrlForProcessing('https://example.com/story?utm_source=newsletter&gclid=abc123&id=42#frag'),
    ).toBe('https://example.com/story?id=42');
  });

  it('rejects local-only hosts for remote-processing flows', () => {
    expect(sanitizeUrlForProcessing('http://localhost:8080/image.png')).toBeNull();
    expect(sanitizeUrlForProcessing('http://127.0.0.1:3000/image.png')).toBeNull();
    expect(sanitizeUrlForProcessing('http://192.168.1.10/chart.png')).toBeNull();
  });

  it('blocks direct external opens to localhost/private hosts', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    expect(await openExternalUrl('http://localhost:8080')).toBe(false);
    expect(await openExternalUrl('http://127.0.0.1:3000')).toBe(false);
    expect(await openExternalUrl('http://192.168.1.10')).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('extracts a safe hostname', () => {
    expect(getSafeExternalHostname('https://www.example.com/article')).toBe('example.com');
  });

  it('opens only safe external urls', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    expect(await openExternalUrl('https://example.com')).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');

    expect(await openExternalUrl('javascript:alert(1)')).toBe(false);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks links marked unsafe by safety checks', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    vi.mocked(checkUrlSafety).mockResolvedValueOnce({
      url: 'https://bad.example/',
      checked: true,
      status: 'unsafe',
      safe: false,
      blocked: true,
      reason: 'flagged',
      threats: [
        {
          threatType: 'MALWARE',
          platformType: 'ANY_PLATFORM',
          threatEntryType: 'URL',
          url: 'https://bad.example/',
        },
      ],
    });

    expect(await openExternalUrl('https://bad.example')).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('blocks unknown safety verdicts by default fail-closed policy', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    vi.mocked(checkUrlSafety).mockResolvedValueOnce({
      url: 'https://unknown.example/',
      checked: false,
      status: 'unknown',
      safe: true,
      blocked: false,
      reason: 'timeout',
      threats: [],
    });

    expect(await openExternalUrl('https://unknown.example')).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('allows unknown safety verdicts when fail-closed override is disabled', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    vi.mocked(checkUrlSafety).mockResolvedValueOnce({
      url: 'https://unknown.example/',
      checked: false,
      status: 'unknown',
      safe: true,
      blocked: false,
      reason: 'timeout',
      threats: [],
    });

    expect(await openExternalUrl('https://unknown.example', { failClosedOnUnknown: false })).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when safety checking throws unexpectedly', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('window', { open: openSpy });

    vi.mocked(checkUrlSafety).mockRejectedValueOnce(new Error('network blew up'));

    expect(await openExternalUrl('https://example.com')).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
