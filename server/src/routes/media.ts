import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError, UpstreamError, ValidationError } from '../lib/errors.js';
import { transcriptionWorkerBridge } from '../services/media/transcriptionWorkerBridge.js';

const MAX_VTT_BYTES = 20_000;

const RemoteTranscriptionSchema = z.object({
  url: z.string().url().max(2_000),
  language: z.string().min(2).max(12).optional(),
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

async function downloadRemoteFile(dirPath: string, rawUrl: string): Promise<string> {
  const url = ensureHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.TRANSCRIPTION_REMOTE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new UpstreamError(`Unable to fetch remote media (${response.status}).`, { url: url.toString() }, 502);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > env.TRANSCRIPTION_MAX_FILE_BYTES) {
      throw new ValidationError(`Remote media exceeds the ${Math.round(env.TRANSCRIPTION_MAX_FILE_BYTES / (1024 * 1024))}MB limit.`);
    }

    const ext = extname(url.pathname) || '.media';
    const targetPath = join(dirPath, `remote${ext}`);
    const bodyStream = Readable.fromWeb(response.body as any);
    await pipeline(bodyStream, createWriteStream(targetPath));
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

    const result = await withTempDir(async (dirPath) => {
      const filePath = await writeUploadedFile(dirPath, fileValue);
      return transcriptionWorkerBridge.transcribe({
        filePath,
        ...(language ? { language } : {}),
        maxVttBytes: MAX_VTT_BYTES,
      });
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
      maxVttBytes: MAX_VTT_BYTES,
    });
  });

  return c.json({ ok: true, result });
});

mediaRouter.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ ok: false, error: error.message, code: error.code, details: error.details }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504);
  }

  return c.json({ ok: false, error: 'Media route failed' }, 500);
});