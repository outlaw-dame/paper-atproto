import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    GOOGLE_SAFE_BROWSING_API_KEY: 'test-key',
    SAFE_BROWSING_CACHE_MAX_ENTRIES: 2000,
  },
}));

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

describe('safeBrowsing service retry behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    envMock.GOOGLE_SAFE_BROWSING_API_KEY = 'test-key';
  });

  it('retries transient 503 responses and eventually returns safe', async () => {
    const first = {
      ok: false,
      status: 503,
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'temporary outage'),
    };

    const second = {
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => ''),
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlAgainstSafeBrowsing } = await import('./safeBrowsing.js');
    const result = await checkUrlAgainstSafeBrowsing('https://example.com/path');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('safe');
    expect(result.safe).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('does not retry non-retryable 400 responses', async () => {
    const badRequest = {
      ok: false,
      status: 400,
      headers: { get: vi.fn(() => null) },
      text: vi.fn(async () => 'invalid request'),
    };

    const fetchMock = vi.fn().mockResolvedValueOnce(badRequest);
    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlAgainstSafeBrowsing } = await import('./safeBrowsing.js');
    const result = await checkUrlAgainstSafeBrowsing('https://example.com/path');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('unknown');
    expect(result.safe).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('returns unknown without fetch when API key is missing', async () => {
    envMock.GOOGLE_SAFE_BROWSING_API_KEY = '';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlAgainstSafeBrowsing } = await import('./safeBrowsing.js');
    const result = await checkUrlAgainstSafeBrowsing('https://example.com/path');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe('unknown');
    expect(result.checked).toBe(false);
    expect(result.reason).toContain('API key is not configured');
  });

  it('coalesces concurrent checks for the same URL into one upstream request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchMock = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        headers: { get: vi.fn(() => null) },
        json: vi.fn(async () => ({})),
        text: vi.fn(async () => ''),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlAgainstSafeBrowsing } = await import('./safeBrowsing.js');
    const first = checkUrlAgainstSafeBrowsing('https://example.com/path');
    const second = checkUrlAgainstSafeBrowsing('https://example.com/path');

    release();
    const [one, two] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(one.status).toBe('safe');
    expect(two.status).toBe('safe');
  });

  it('returns cached verdict on repeated URL checks without refetching', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => null) },
      json: vi.fn(async () => ({})),
      text: vi.fn(async () => ''),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlAgainstSafeBrowsing } = await import('./safeBrowsing.js');

    const first = await checkUrlAgainstSafeBrowsing('https://example.com/path');
    const second = await checkUrlAgainstSafeBrowsing('https://example.com/path');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('safe');
    expect(second.status).toBe('safe');
  });
});
