import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import app from '../server/src/app';

type ZstdDecompressSync = (buffer: Uint8Array) => Buffer;

const zlibAny = (await import('node:zlib')) as unknown as {
  zstdDecompressSync?: ZstdDecompressSync;
};

const LARGE_TEXT = 'compression-check '.repeat(220);
const HUGE_TEXT = 'oversized-check '.repeat(100_000);
const SMALL_TEXT = 'tiny response';

app.get('/__compression-test/plain', (c) => c.text(LARGE_TEXT));
app.get('/__compression-test/oversized', (c) => c.text(HUGE_TEXT));
app.get('/__compression-test/small', (c) => c.text(SMALL_TEXT));
app.get('/__compression-test/no-transform', (c) => {
  c.header('Cache-Control', 'no-transform, public, max-age=60');
  return c.text(LARGE_TEXT);
});
app.get('/__compression-test/partial', (c) => {
  c.status(206);
  c.header('Content-Range', 'bytes 0-19/200');
  return c.text(LARGE_TEXT.slice(0, 20));
});
app.get('/__compression-test/sse', (c) => new Response('data: hello\n\n', {
  headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
  },
}));
app.get('/__compression-test/problem', (c) => c.json({
  type: 'https://example.com/problem',
  title: 'Example problem',
  detail: LARGE_TEXT,
}, 400, {
  'Content-Type': 'application/problem+json; charset=utf-8',
}));

function toBuffer(responseBody: ArrayBuffer): Buffer {
  return Buffer.from(responseBody);
}

describe('server compression middleware integration', () => {
  it('serves gzip when requested and beneficial', async () => {
    const response = await app.request('http://localhost/__compression-test/plain', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect((response.headers.get('Vary') ?? '').toLowerCase()).toContain('accept-encoding');

    const decompressed = gunzipSync(toBuffer(await response.arrayBuffer())).toString('utf8');
    expect(decompressed).toBe(LARGE_TEXT);
  });

  it('serves zstd when available and requested, otherwise falls back to gzip', async () => {
    const response = await app.request('http://localhost/__compression-test/plain', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'zstd, gzip;q=0.8',
      },
    });

    expect(response.status).toBe(200);

    const encoding = response.headers.get('Content-Encoding');
    if (typeof zlibAny.zstdDecompressSync === 'function') {
      expect(encoding).toBe('zstd');
      const decompressed = zlibAny.zstdDecompressSync(toBuffer(await response.arrayBuffer())).toString('utf8');
      expect(decompressed).toBe(LARGE_TEXT);
      return;
    }

    expect(encoding).toBe('gzip');
    const decompressed = gunzipSync(toBuffer(await response.arrayBuffer())).toString('utf8');
    expect(decompressed).toBe(LARGE_TEXT);
  });

  it('respects explicit identity encoding', async () => {
    const response = await app.request('http://localhost/__compression-test/plain', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'identity',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect((response.headers.get('Vary') ?? '').toLowerCase()).toContain('accept-encoding');
    expect(await response.text()).toBe(LARGE_TEXT);
  });

  it('adds Vary: Accept-Encoding on compressible identity responses for cache correctness', async () => {
    const response = await app.request('http://localhost/__compression-test/small', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect((response.headers.get('Vary') ?? '').toLowerCase()).toContain('accept-encoding');
    expect(await response.text()).toBe(SMALL_TEXT);
  });

  it('does not transform no-transform responses', async () => {
    const response = await app.request('http://localhost/__compression-test/no-transform', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, zstd',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(LARGE_TEXT);
  });

  it('does not compress partial content responses', async () => {
    const response = await app.request('http://localhost/__compression-test/partial', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, zstd',
      },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Content-Range')).toBe('bytes 0-19/200');
    expect(await response.text()).toBe(LARGE_TEXT.slice(0, 20));
  });

  it('does not compress server-sent event responses', async () => {
    const response = await app.request('http://localhost/__compression-test/sse', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, zstd',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await response.text()).toBe('data: hello\n\n');
  });

  it('compresses structured +json media types like application/problem+json', async () => {
    const response = await app.request('http://localhost/__compression-test/problem', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect((response.headers.get('Vary') ?? '').toLowerCase()).toContain('accept-encoding');
    const decompressed = gunzipSync(toBuffer(await response.arrayBuffer())).toString('utf8');
    expect(decompressed).toContain('"title":"Example problem"');
    expect(decompressed).toContain('compression-check');
  });

  it('skips compression for oversized responses', async () => {
    const response = await app.request('http://localhost/__compression-test/oversized', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip, zstd',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(HUGE_TEXT);
  });
});
