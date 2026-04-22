#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function parsePositiveInt(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseArg(argv, key) {
  const index = argv.findIndex((item) => item === key || item.startsWith(`${key}=`));
  if (index < 0) return null;
  if (argv[index].includes('=')) return argv[index].split('=').slice(1).join('=');
  return argv[index + 1] ?? null;
}

function parseListArg(argv, key) {
  const single = parseArg(argv, key);
  if (!single) return [];
  return single
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function createSyntheticPayload() {
  const nested = {
    user: {
      did: 'did:plc:example123',
      handle: 'benchmark.example',
      displayName: 'Compression Benchmark User',
      locale: 'en-US',
    },
    feed: Array.from({ length: 250 }, (_, i) => ({
      id: `post-${i}`,
      text: `This is a repeated benchmark payload line ${i}. `.repeat(6),
      tags: ['compression', 'benchmark', 'performance', 'atproto'],
      stats: { likes: i * 3, reposts: i, replies: i % 7 },
    })),
  };
  return Buffer.from(JSON.stringify(nested), 'utf8');
}

async function loadInputs(argv) {
  const requested = parseListArg(argv, '--input');
  const resolved = [];

  for (const entry of requested) {
    const candidate = path.resolve(process.cwd(), entry);
    let metadata;
    try {
      metadata = await stat(candidate);
    } catch (error) {
      console.warn(`[compression-benchmark] skipping missing input: ${entry} (${String(error)})`);
      continue;
    }

    if (!metadata.isFile()) {
      console.warn(`[compression-benchmark] skipping non-file input: ${entry}`);
      continue;
    }

    if (metadata.size <= 0 || metadata.size > MAX_INPUT_BYTES) {
      console.warn(
        `[compression-benchmark] skipping ${entry} (size ${metadata.size} out of allowed range 1..${MAX_INPUT_BYTES})`,
      );
      continue;
    }

    const bytes = await readFile(candidate);
    resolved.push({ name: entry, data: bytes });
  }

  if (!resolved.length) {
    resolved.push({ name: 'synthetic:timeline-json', data: createSyntheticPayload() });
  }

  return resolved;
}

async function makeCodecs(zstdLevel) {
  const codecs = [
    {
      name: 'gzip',
      levels: [1, 3, 6, 9],
      compress: (input, level) => gzipSync(input, { level }),
      decompress: (input) => gunzipSync(input),
    },
  ];

  const zlibAny = /** @type {{ zstdCompressSync?: Function; zstdDecompressSync?: Function }} */ (
    await import('node:zlib')
  );
  if (typeof zlibAny.zstdCompressSync === 'function' && typeof zlibAny.zstdDecompressSync === 'function') {
    const safeLevel = Math.max(1, Math.min(22, zstdLevel));
    codecs.push({
      name: 'zstd',
      levels: [Math.max(1, safeLevel - 3), safeLevel, Math.min(22, safeLevel + 3)],
      compress: (input, level) => zlibAny.zstdCompressSync(input, { level }),
      decompress: (input) => zlibAny.zstdDecompressSync(input),
    });
  } else {
    console.warn('[compression-benchmark] zstd not supported by current Node runtime; gzip-only benchmark.');
  }

  return codecs;
}

async function benchmark() {
  const argv = process.argv.slice(2);
  const iterations = parsePositiveInt(parseArg(argv, '--iterations'), 60);
  const warmups = parsePositiveInt(parseArg(argv, '--warmups'), 8);
  const zstdLevel = parsePositiveInt(parseArg(argv, '--zstd-level'), 8);

  const datasets = await loadInputs(argv);
  const codecs = await makeCodecs(zstdLevel);

  console.log('Compression Benchmark');
  console.log(`Iterations: ${iterations}`);
  console.log(`Warmups: ${warmups}`);
  console.log('');

  for (const dataset of datasets) {
    console.log(`Dataset: ${dataset.name} (${formatBytes(dataset.data.byteLength)})`);

    for (const codec of codecs) {
      for (const level of codec.levels) {
        let lastCompressed = null;

        for (let i = 0; i < warmups; i += 1) {
          lastCompressed = codec.compress(dataset.data, level);
          codec.decompress(lastCompressed);
        }

        const compressSamples = [];
        const decompressSamples = [];

        for (let i = 0; i < iterations; i += 1) {
          const t1 = nowMs();
          const compressed = codec.compress(dataset.data, level);
          const t2 = nowMs();
          const decompressed = codec.decompress(compressed);
          const t3 = nowMs();

          if (!decompressed.equals(dataset.data)) {
            throw new Error(`${codec.name} level ${level} round-trip mismatch for dataset ${dataset.name}`);
          }

          lastCompressed = compressed;
          compressSamples.push(t2 - t1);
          decompressSamples.push(t3 - t2);
        }

        if (!lastCompressed) continue;

        const ratio = (lastCompressed.byteLength / dataset.data.byteLength).toFixed(4);
        const savings = ((1 - lastCompressed.byteLength / dataset.data.byteLength) * 100).toFixed(2);
        const line = [
          `${codec.name}@${level}`.padEnd(10),
          `size=${formatBytes(lastCompressed.byteLength).padEnd(12)}`,
          `ratio=${ratio}`,
          `saved=${savings}%`,
          `c-p50=${percentile(compressSamples, 50).toFixed(3)}ms`,
          `c-p95=${percentile(compressSamples, 95).toFixed(3)}ms`,
          `d-p50=${percentile(decompressSamples, 50).toFixed(3)}ms`,
          `d-p95=${percentile(decompressSamples, 95).toFixed(3)}ms`,
        ].join(' | ');
        console.log(line);
      }
    }

    console.log('');
  }
}

benchmark().catch((error) => {
  console.error('[compression-benchmark] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
