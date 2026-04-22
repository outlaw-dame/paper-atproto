import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('urlSafety cache behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    });
  });

  it('deduplicates concurrent checks for the same URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: {
        url: 'https://example.com/',
        checked: true,
        status: 'safe',
        safe: true,
        blocked: false,
        threats: [],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlSafety } = await import('./urlSafety');
    const [a, b] = await Promise.all([
      checkUrlSafety('https://example.com'),
      checkUrlSafety('https://example.com'),
    ]);

    expect(a.status).toBe('safe');
    expect(b.status).toBe('safe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes unknown verdicts after short TTL expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('offline', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          url: 'https://example.com/',
          checked: true,
          status: 'safe',
          safe: true,
          blocked: false,
          threats: [],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    vi.stubGlobal('fetch', fetchMock);

    const { checkUrlSafety } = await import('./urlSafety');

    const first = await checkUrlSafety('https://example.com');
    expect(first.status).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past UNKNOWN_CACHE_TTL_MS (30s), cache should refresh.
    vi.advanceTimersByTime(30_001);

    const second = await checkUrlSafety('https://example.com');
    expect(second.status).toBe('safe');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
