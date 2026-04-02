import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError, UpstreamError, ValidationError } from '../lib/errors.js';
import { sanitizeRemoteProcessingUrl } from '../lib/sanitize.js';
import { transcriptionWorkerBridge } from '../services/media/transcriptionWorkerBridge.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from '../services/safeBrowsing.js';

const MAX_VTT_BYTES = 20_000;
const TRANSCRIPTION_REMOTE_MAX_REDIRECTS = 3;
const REMOTE_TRANSCRIPTION_ACCEPT_HEADER = [
  'audio/*',
  'video/*',
  'application/octet-stream',
  'application/ogg',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
].join(', ');
const SUPPORTED_REMOTE_MEDIA_CONTENT_TYPES = [
  'audio/',
  'video/',
  'application/octet-stream',
  'application/ogg',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
] as const;

const RemoteTranscriptionSchema = z.object({
  url: z.string().url().max(2_000),
  language: z.string().min(2).max(12).optional(),
  profile: z.enum(['fast', 'quality', 'long_form']).optional(),
});

function sanitizeFilename(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, '_') || 'media';
}

function ensureHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError('Only http(s) media URLs are supported.');
  }
  return url;
}

function isRedirectStatus(status: number): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

async function assertSafeRemoteMediaUrl(url: string): Promise<void> {
  const verdict = await checkUrlAgainstSafeBrowsing(url);
  if (!shouldBlockSafeBrowsingVerdict(verdict)) return;
  throw new ValidationError(
    verdict.reason ?? 'Remote media URL blocked by Google Safe Browsing.',
  );
}

function ensureSupportedRemoteMediaHeaders(response: Response): void {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    contentType
    && !SUPPORTED_REMOTE_MEDIA_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix))
  ) {
    throw new ValidationError(`Remote media content type is not supported for transcription: ${contentType}`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (!Number.isFinite(contentLength)) return;
  if (contentLength > env.TRANSCRIPTION_MAX_FILE_BYTES) {
    throw new ValidationError(`Remote media exceeds the ${Math.round(env.TRANSCRIPTION_MAX_FILE_BYTES / (1024 * 1024))}MB limit.`);
  }
}

async function streamRemoteMediaToFile(response: Response, targetPath: string): Promise<void> {
  if (!response.body) {
    throw new UpstreamError('Remote media response body was empty.', undefined, 502);
  }

  let bytesRead = 0;
  const byteLimit = env.TRANSCRIPTION_MAX_FILE_BYTES;
  const sizeGuard = new Transform({
    transform(chunk, _encoding, callback) {
      const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      bytesRead += chunkSize;
      if (bytesRead > byteLimit) {
        callback(new ValidationError(
          `Remote media exceeds the ${Math.round(byteLimit / (1024 * 1024))}MB limit.`,
        ));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as any),
    sizeGuard,
    createWriteStream(targetPath),
  );
}

async function withTempDir<T>(callback: (dirPath: string) => Promise<T>): Promise<T> {
  const dirPath = await mkdtemp(join(tmpdir(), 'paper-atproto-media-'));
  try {
    return await callback(dirPath);
  } finally {
    await rm(dirPath, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeUploadedFile(dirPath: string, file: File): Promise<string> {
  const safeName = sanitizeFilename(file.name || `upload${extname(file.type || '')}`);
  const targetPath = join(dirPath, safeName);
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength > env.TRANSCRIPTION_MAX_FILE_BYTES) {
    throw new ValidationError(`Uploaded media exceeds the ${Math.round(env.TRANSCRIPTION_MAX_FILE_BYTES / (1024 * 1024))}MB limit.`);
  }
  await mkdir(dirPath, { recursive: true });
  await writeFile(targetPath, Buffer.from(arrayBuffer));
  return targetPath;
}

async function downloadRemoteFile(
  dirPath: string,
  rawUrl: string,
  redirectCount = 0,
): Promise<string> {
  const sanitizedUrl = sanitizeRemoteProcessingUrl(rawUrl);
  if (!sanitizedUrl) {
    throw new ValidationError('Only public http(s) media URLs are supported.');
  }

  const url = ensureHttpUrl(sanitizedUrl);
  await assertSafeRemoteMediaUrl(url.toString());
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.TRANSCRIPTION_REMOTE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: REMOTE_TRANSCRIPTION_ACCEPT_HEADER,
      },
    });

    if (isRedirectStatus(response.status)) {
      if (redirectCount >= TRANSCRIPTION_REMOTE_MAX_REDIRECTS) {
        throw new UpstreamError('Remote media redirect limit exceeded.', { url: url.toString() }, 502);
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new UpstreamError('Remote media redirect missing location header.', { url: url.toString() }, 502);
      }

      const nextUrl = new URL(location, url).toString();
      const sanitizedNextUrl = sanitizeRemoteProcessingUrl(nextUrl);
      if (!sanitizedNextUrl) {
        throw new ValidationError('Remote media redirect target is unsafe.');
      }

      return downloadRemoteFile(dirPath, sanitizedNextUrl, redirectCount + 1);
    }

    if (!response.ok || !response.body) {
      throw new UpstreamError(`Unable to fetch remote media (${response.status}).`, { url: url.toString() }, 502);
    }

    ensureSupportedRemoteMediaHeaders(response);

    const ext = extname(url.pathname) || '.media';
    const targetPath = join(dirPath, `remote${ext}`);
    await streamRemoteMediaToFile(response, targetPath);
    return targetPath;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamError('Timed out while fetching remote media.', { url: url.toString() }, 504);
    }
    throw new UpstreamError('Failed to fetch remote media.', {
      url: url.toString(),
      cause: error instanceof Error ? error.message : String(error),
    }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

export const mediaRouter = new Hono();

mediaRouter.post('/transcribe', async (c) => {
  const contentType = c.req.header('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const fileValue = form.get('file');
    const languageValue = form.get('language');
    if (!(fileValue instanceof File)) {
      return c.json({ ok: false, error: 'Missing media file.' }, 400);
    }

    const language = typeof languageValue === 'string' && languageValue.trim()
      ? languageValue.trim()
      : undefined;
    const profileValue = form.get('profile');
    const profile = typeof profileValue === 'string' && ['fast', 'quality', 'long_form'].includes(profileValue)
      ? profileValue as 'fast' | 'quality' | 'long_form'
      : undefined;

    const result = await withTempDir(async (dirPath) => {
      const filePath = await writeUploadedFile(dirPath, fileValue);
      return transcriptionWorkerBridge.transcribe({
        filePath,
        ...(language ? { language } : {}),
        ...(profile ? { profile } : {}),
        maxVttBytes: MAX_VTT_BYTES,
      });
    });

    console.info('[media/transcribe][telemetry]', {
      source: 'upload',
      language: result.language,
      model: result.model,
      profile: result.profile ?? 'quality',
      durationSeconds: result.durationSeconds,
      at: new Date().toISOString(),
    });

    return c.json({ ok: true, result });
  }

  const body = await c.req.json().catch(() => null);
  const parsed = RemoteTranscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid transcription request', issues: parsed.error.issues }, 400);
  }

  const result = await withTempDir(async (dirPath) => {
    const filePath = await downloadRemoteFile(dirPath, parsed.data.url);
    return transcriptionWorkerBridge.transcribe({
      filePath,
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.profile ? { profile: parsed.data.profile } : {}),
      maxVttBytes: MAX_VTT_BYTES,
    });
  });

  console.info('[media/transcribe][telemetry]', {
    source: 'remote',
    language: result.language,
    model: result.model,
    profile: result.profile ?? 'quality',
    durationSeconds: result.durationSeconds,
    at: new Date().toISOString(),
  });

  return c.json({ ok: true, result });
});

mediaRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: error.message, code: error.code, details: error.details }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
  }

  return c.json({ ok: false, error: 'Media route failed' }, 500);
});
