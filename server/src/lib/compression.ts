import type { MiddlewareHandler } from 'hono';
import { gzip as gzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const gzip = promisify(gzipCallback);
const MAX_ZSTD_WINDOW_LOG = 23;

const TRANSIENT_ENCODING_HEADER_MAX_LEN = 512;
const MIN_COMPRESSIBLE_LENGTH = 64;
const NON_COMPRESSIBLE_CONTENT_TYPES = [
  /^text\/event-stream(?:;|$)/i,
];
const COMPRESSIBLE_CONTENT_TYPES = [
  /^text\//i,
  /^application\/(?:json|javascript|xml|x-javascript|x-www-form-urlencoded)(?:;|$)/i,
  /^application\/[a-z0-9.+-]+\+(?:json|xml)(?:;|$)/i,
  /^application\/(?:manifest\+json|ld\+json)(?:;|$)/i,
  /^image\/svg\+xml(?:;|$)/i,
];
const ALREADY_COMPRESSED_CONTENT_TYPES = [
  /^image\/(?:avif|webp|jpeg|jpg|png|gif)(?:;|$)/i,
  /^audio\//i,
  /^video\//i,
  /^application\/(?:zip|gzip|zstd|x-gzip|x-7z-compressed|x-rar-compressed|pdf)(?:;|$)/i,
];

type ContentEncoding = 'zstd' | 'gzip' | 'identity';

type ZstdCompressCallback = (
  buffer: Uint8Array,
  options: ZstdOptions,
  callback: (error: Error | null, result: Buffer) => void,
) => void;
type ZstdOptions = {
  level?: number;
  maxOutputLength?: number;
  params?: Record<number, number>;
};
type ZstdCompressSync = (buffer: Uint8Array, options?: ZstdOptions) => Buffer;

const zlibAny = (await import('node:zlib')) as unknown as {
  constants?: {
    ZSTD_c_compressionLevel?: number;
    ZSTD_c_windowLog?: number;
  };
  zstdCompress?: ZstdCompressCallback;
  zstdCompressSync?: ZstdCompressSync;
};
const zstdCompress = zlibAny.zstdCompress
  ? promisify((buffer: Uint8Array, options: ZstdOptions, callback: (error: Error | null, result: Buffer) => void) => (
    zlibAny.zstdCompress?.(buffer, options, callback)
  ))
  : null;

function supportsZstd(): boolean {
  return typeof zstdCompress === 'function' || typeof zlibAny.zstdCompressSync === 'function';
}

function parseAcceptEncoding(headerValue: string | undefined): Map<string, number> {
  const weighted = new Map<string, number>();
  if (!headerValue) return weighted;

  const trimmed = headerValue.trim().slice(0, TRANSIENT_ENCODING_HEADER_MAX_LEN);
  if (!trimmed) return weighted;

  for (const entry of trimmed.split(',')) {
    const token = entry.trim();
    if (!token) continue;

    const match = token.match(/^([a-zA-Z0-9*_-]+)(?:\s*;\s*q=([01](?:\.\d{0,3})?))?$/);
    if (!match) continue;

    const codingRaw = match[1];
    if (!codingRaw) continue;
    const coding = codingRaw.toLowerCase();
    const parsedQ = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(parsedQ)) continue;

    const q = Math.max(0, Math.min(1, parsedQ));
    const existing = weighted.get(coding);
    if (existing === undefined || q > existing) {
      weighted.set(coding, q);
    }
  }

  return weighted;
}

function resolveEncoding(headerValue: string | undefined): ContentEncoding {
  const weighted = parseAcceptEncoding(headerValue);
  const wildcard = weighted.get('*') ?? 0;
  const gzipWeight = weighted.get('gzip') ?? wildcard;
  const zstdWeight = weighted.get('zstd') ?? wildcard;
  const identityWeight = weighted.get('identity') ?? (weighted.size ? wildcard : 1);

  if (supportsZstd() && zstdWeight > 0 && zstdWeight >= gzipWeight) {
    return 'zstd';
  }
  if (gzipWeight > 0) {
    return 'gzip';
  }
  if (identityWeight > 0) {
    return 'identity';
  }
  return 'identity';
}

function isCompressibleContentType(contentType: string): boolean {
  if (NON_COMPRESSIBLE_CONTENT_TYPES.some((pattern) => pattern.test(contentType))) return false;
  if (ALREADY_COMPRESSED_CONTENT_TYPES.some((pattern) => pattern.test(contentType))) return false;
  return COMPRESSIBLE_CONTENT_TYPES.some((pattern) => pattern.test(contentType));
}

function appendVary(existing: string | null, value: string): string {
  if (!existing) return value;
  const parts = existing
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.some((part) => part.toLowerCase() === value.toLowerCase())) {
    return parts.join(', ');
  }
  parts.push(value);
  return parts.join(', ');
}

function hasNoTransformDirective(cacheControl: string | null): boolean {
  if (!cacheControl) return false;
  return cacheControl
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .includes('no-transform');
}

function parseContentLengthHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | 'too_large' | null> {
  const body = response.body;
  if (!body) {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return 'too_large';
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function compressBody(body: Uint8Array, encoding: ContentEncoding): Promise<Uint8Array> {
  if (encoding === 'gzip') {
    return gzip(body, {
      level: env.COMPRESSION_GZIP_LEVEL,
      maxOutputLength: body.byteLength + 64 * 1024,
    });
  }

  if (encoding === 'zstd') {
    const zstdOptions: ZstdOptions = {
      level: env.COMPRESSION_ZSTD_LEVEL,
      maxOutputLength: body.byteLength + 64 * 1024,
    };
    if (zlibAny.constants?.ZSTD_c_compressionLevel !== undefined && zlibAny.constants?.ZSTD_c_windowLog !== undefined) {
      zstdOptions.params = {
        [zlibAny.constants.ZSTD_c_compressionLevel]: env.COMPRESSION_ZSTD_LEVEL,
        [zlibAny.constants.ZSTD_c_windowLog]: MAX_ZSTD_WINDOW_LOG,
      };
    }

    if (zstdCompress) {
      return zstdCompress(body, zstdOptions);
    }

    if (zlibAny.zstdCompressSync) {
      return zlibAny.zstdCompressSync(body, zstdOptions);
    }
  }

  return body;
}

function shouldSkipCompressionForStatus(status: number): boolean {
  return status < 200 || status === 204 || status === 206 || status === 304;
}

export function compressionMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (!env.COMPRESSION_ENABLED) {
      return next();
    }

    await next();

    const method = c.req.method.toUpperCase();
    if (method === 'HEAD') return;

    const response = c.res;
    const status = response.status;
    if (shouldSkipCompressionForStatus(status)) return;

    if (response.headers.has('Content-Encoding')) return;
    if (hasNoTransformDirective(response.headers.get('Cache-Control'))) return;
    if (response.headers.has('Content-Range')) return;

    const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
    if (!isCompressibleContentType(contentType)) return;

    const currentVary = response.headers.get('Vary');
    const varyWithEncoding = appendVary(currentVary, 'Accept-Encoding');
    if (varyWithEncoding !== currentVary) {
      response.headers.set('Vary', varyWithEncoding);
    }

    const encoding = resolveEncoding(c.req.header('accept-encoding'));
    if (encoding === 'identity') return;

    const declaredLength = parseContentLengthHeader(response.headers.get('Content-Length'));
    const minCompressibleBytes = Math.max(MIN_COMPRESSIBLE_LENGTH, env.COMPRESSION_MIN_BYTES);
    if (declaredLength !== null) {
      if (declaredLength < minCompressibleBytes) return;
      if (declaredLength > env.COMPRESSION_MAX_BYTES) return;
    }

    let bodyBuffer: Uint8Array;
    try {
      const probeResponse = response.clone();
      const readResult = await readResponseBodyWithLimit(probeResponse, env.COMPRESSION_MAX_BYTES);
      if (readResult === null || readResult === 'too_large') return;
      bodyBuffer = readResult;
    } catch {
      // If body cannot be buffered (e.g., stream already consumed), preserve the original response.
      return;
    }

    const originalLength = bodyBuffer.byteLength;
    if (originalLength < minCompressibleBytes) return;
    if (originalLength > env.COMPRESSION_MAX_BYTES) return;

    let compressed: Uint8Array;
    try {
      compressed = await compressBody(bodyBuffer, encoding);
    } catch {
      // Compression failures should never break response delivery.
      return;
    }

    if (compressed.byteLength >= originalLength) return;

    try {
      const compressedNodeBuffer = Buffer.from(compressed);

      const headers = new Headers(response.headers);
      headers.set('Content-Encoding', encoding);
      headers.set('Content-Length', String(compressedNodeBuffer.byteLength));
      headers.delete('ETag');

      c.res = new Response(compressedNodeBuffer as unknown as BodyInit, {
        status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // Never allow encoding adaptation failures to surface as request failures.
      return;
    }
  };
}
