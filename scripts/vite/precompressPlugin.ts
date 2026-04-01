import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

type ZstdCompressOptions = { level?: number };
type ZstdCompressSync = (buffer: Uint8Array, options?: ZstdCompressOptions) => Buffer;

const TRANSIENT_FS_ERROR_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'EAGAIN']);
const DEFAULT_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.txt',
  '.xml',
  '.svg',
  '.wasm',
  '.map',
]);

export type PrecompressPluginOptions = {
  minSizeBytes?: number;
  gzipLevel?: number;
  zstdLevel?: number;
  maxFileBytes?: number;
};

type CompressionCodec = {
  name: 'gzip' | 'zstd';
  extension: '.gz' | '.zst';
  compress: (input: Uint8Array) => Uint8Array;
};

const zlibAny = (await import('node:zlib')) as unknown as {
  zstdCompressSync?: ZstdCompressSync;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(exp * 0.3);
  const min = Math.max(0, exp - jitter);
  const max = exp + jitter;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function writeFileWithRetry(targetPath: string, payload: Uint8Array): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, payload);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      const isLast = attempt === 3;
      if (!code || !TRANSIENT_FS_ERROR_CODES.has(code) || isLast) {
        throw error;
      }
      await sleep(computeBackoffDelay(attempt, 40, 600));
    }
  }
  throw lastError;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const pending = [rootDir];
  const files: string[] = [];

  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(absolute);
    }
  }

  return files;
}

function shouldCompressFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gz' || ext === '.zst' || ext === '.br') return false;
  return DEFAULT_EXTENSIONS.has(ext);
}

function buildCodecs(gzipLevel: number, zstdLevel: number): CompressionCodec[] {
  const codecs: CompressionCodec[] = [
    {
      name: 'gzip',
      extension: '.gz',
      compress: (input) => gzipSync(input, { level: gzipLevel }),
    },
  ];

  if (typeof zlibAny.zstdCompressSync === 'function') {
    codecs.push({
      name: 'zstd',
      extension: '.zst',
      compress: (input) => zlibAny.zstdCompressSync!(input, { level: zstdLevel }),
    });
  }

  return codecs;
}

export function precompressPlugin(options?: PrecompressPluginOptions): Plugin {
  const minSizeBytes = options?.minSizeBytes ?? 1024;
  const gzipLevel = options?.gzipLevel ?? 6;
  const zstdLevel = options?.zstdLevel ?? 8;
  const maxFileBytes = options?.maxFileBytes ?? 4_000_000;
  let config: ResolvedConfig | null = null;

  return {
    name: 'paper-precompress-assets',
    apply: 'build',
    enforce: 'post',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async closeBundle() {
      if (!config) return;

      const outDir = path.resolve(config.root, config.build.outDir);
      const files = await walkFiles(outDir);
      const codecs = buildCodecs(gzipLevel, zstdLevel);

      if (!codecs.some((codec) => codec.name === 'zstd')) {
        config.logger.warn(
          '[paper-precompress-assets] Node runtime lacks zstd support; generated gzip only.',
        );
      }

      for (const filePath of files) {
        if (!shouldCompressFile(filePath)) continue;

        const fileStats = await stat(filePath);
        if (fileStats.size < minSizeBytes || fileStats.size > maxFileBytes) continue;

        const source = await readFile(filePath);
        for (const codec of codecs) {
          let compressed: Uint8Array;
          try {
            compressed = codec.compress(source);
          } catch (error) {
            config.logger.warn(
              `[paper-precompress-assets] ${codec.name} failed for ${path.relative(outDir, filePath)}: ${String(error)}`,
            );
            continue;
          }

          if (compressed.byteLength >= source.byteLength) continue;

          const targetPath = `${filePath}${codec.extension}`;
          await writeFileWithRetry(targetPath, compressed);
        }
      }
    },
  };
}
