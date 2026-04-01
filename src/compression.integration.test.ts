import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import app from '../server/src/app';

type ZstdDecompressSync = (buffer: Uint8Array) => Buffer;

const zlibAny = (await import('node:zlib')) as unknown as {
  zstdDecompressSync?: ZstdDecompressSync;
};

const LARGE_TEXT = 'compression-check '.repeat(220);
const HUGE_TEXT = 'oversized-check '.repeat(100_000);

app.get('/__compression-test/plain', (c) => c.text(LARGE_TEXT));
app.get('/__compression-test/oversized', (c) => c.text(HUGE_TEXT));
app.get('/__compression-test/no-transform', (c) => {
  c.header('Cache-Control', 'no-transform, public, max-age=60');
  return c.text(LARGE_TEXT);
});

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
    expect(await response.text()).toBe(LARGE_TEXT);
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
