#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = process.env.MULTIMODAL_EVAL_BASE_URL?.trim() || 'http://127.0.0.1:3011';
const DEFAULT_INLINE_BACKEND_URL = process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434';
const DEFAULT_DATASET = 'scripts/multimodal_eval_set.sample.jsonl';
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    dataset: DEFAULT_DATASET,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: 2,
    minConfidence: 0.35,
    requireNonFallback: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--base-url' && argv[i + 1]) {
      args.baseUrl = String(argv[i + 1]).trim().replace(/\/$/, '');
      i += 1;
      continue;
    }
    if (token === '--dataset' && argv[i + 1]) {
      args.dataset = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === '--timeout-ms' && argv[i + 1]) {
      args.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--retries' && argv[i + 1]) {
      args.retries = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--min-confidence' && argv[i + 1]) {
      args.minConfidence = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--require-non-fallback') {
      args.requireNonFallback = true;
      continue;
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${args.timeoutMs}`);
  }
  if (!Number.isInteger(args.retries) || args.retries < 0 || args.retries > 10) {
    throw new Error(`Invalid --retries: ${args.retries}`);
  }
  if (!Number.isFinite(args.minConfidence) || args.minConfidence < 0 || args.minConfidence > 1) {
    throw new Error(`Invalid --min-confidence: ${args.minConfidence}`);
  }

  return args;
}

function isLikelyFallbackResponse(prediction) {
  const summary = normalizeText(prediction.mediaSummary ?? '');
  const entities = Array.isArray(prediction.candidateEntities) ? prediction.candidateEntities : [];
  const confidence = Number(prediction.confidence ?? 0);
  return summary === 'media present analysis unavailable' && entities.length === 0 && confidence <= 0.2;
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqNormalized(items) {
  const out = new Set();
  for (const item of items ?? []) {
    const norm = normalizeText(item);
    if (norm) out.add(norm);
  }
  return out;
}

function precision(tp, fp) {
  return tp + fp > 0 ? tp / (tp + fp) : 0;
}

function recall(tp, fn) {
  return tp + fn > 0 ? tp / (tp + fn) : 0;
}

function f1(p, r) {
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

async function readDataset(path) {
  const text = await fs.readFile(path, 'utf8');
  const rows = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at ${path}:${i + 1}: ${error instanceof Error ? error.message : 'parse failed'}`);
    }
    if (!parsed?.id || !parsed?.request || !parsed?.expected) {
      throw new Error(`Missing required keys (id/request/expected) at ${path}:${i + 1}`);
    }
    rows.push(parsed);
  }

  if (rows.length === 0) {
    throw new Error(`Dataset is empty: ${path}`);
  }

  return rows;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function usesInlineFixtures(dataset) {
  return dataset.some((row) => (
    typeof row?.request?.inlineImagePath === 'string' && row.request.inlineImagePath.trim().length > 0
  ));
}

async function probeInlineModelBackend(baseUrl = DEFAULT_INLINE_BACKEND_URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    return {
      baseUrl,
      reachable: response.ok,
      status: response.status,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      baseUrl,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeInlineFixture(payload) {
  const inlinePath = typeof payload.inlineImagePath === 'string' ? payload.inlineImagePath.trim() : '';
  if (!inlinePath) {
    throw new Error('Inline multimodal fixture missing inlineImagePath');
  }

  const absolutePath = path.resolve(process.cwd(), inlinePath);
  const imageBase64 = (await fs.readFile(absolutePath)).toString('base64');
  const { runMediaAnalyzerFromImageBase64 } = await import('../server/src/services/qwenMultimodal.ts');
  const preparedRequest = {
    threadId: String(payload.threadId ?? 'mm-inline-eval'),
    mediaUrl: typeof payload.mediaUrl === 'string' && payload.mediaUrl.trim()
      ? payload.mediaUrl.trim()
      : `https://fixtures.invalid/${path.basename(absolutePath)}`,
    mediaAlt: typeof payload.mediaAlt === 'string' ? payload.mediaAlt : undefined,
    nearbyText: String(payload.nearbyText ?? ''),
    candidateEntities: Array.isArray(payload.candidateEntities) ? payload.candidateEntities : [],
    factualHints: Array.isArray(payload.factualHints) ? payload.factualHints : [],
  };
  return runMediaAnalyzerFromImageBase64(preparedRequest, imageBase64);
}

async function postAnalyzeMedia(baseUrl, payload, timeoutMs, retries) {
  const endpoint = `${baseUrl}/api/llm/analyze/media`;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const status = error && typeof error === 'object' ? error.status : undefined;
      if (attempt >= retries || (status && !RETRYABLE_STATUSES.has(status))) {
        break;
      }
      const backoffMs = Math.min(250 * 2 ** attempt, 2_000);
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

async function analyzeExample(baseUrl, payload, timeoutMs, retries) {
  if (typeof payload.inlineImagePath === 'string' && payload.inlineImagePath.trim()) {
    return analyzeInlineFixture(payload);
  }
  return postAnalyzeMedia(baseUrl, payload, timeoutMs, retries);
}

function evaluateExample(example, prediction) {
  const expectedEntities = uniqNormalized(example.expected.entities ?? []);
  const predictedEntities = uniqNormalized(prediction.candidateEntities ?? []);

  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const entity of predictedEntities) {
    if (expectedEntities.has(entity)) tp += 1;
    else fp += 1;
  }
  for (const entity of expectedEntities) {
    if (!predictedEntities.has(entity)) fn += 1;
  }

  const summary = normalizeText(prediction.mediaSummary ?? '');
  const mustContain = (example.expected.summaryMustContainAny ?? []).map(normalizeText).filter(Boolean);
  const mustNotContain = (example.expected.summaryMustNotContainAny ?? []).map(normalizeText).filter(Boolean);

  const expectedMediaType = normalizeText(example.expected.mediaType ?? '');
  const predictedMediaType = normalizeText(prediction.mediaType ?? '');
  const expectedModerationAction = normalizeText(example.expected.moderationAction ?? '');
  const predictedModerationAction = normalizeText(prediction.moderation?.action ?? 'none');

  const p = precision(tp, fp);
  const r = recall(tp, fn);
  const scoreF1 = f1(p, r);
  const fallbackDetected = isLikelyFallbackResponse(prediction);
  const mediaTypePass = !fallbackDetected && (!expectedMediaType || expectedMediaType === predictedMediaType);
  const summaryMustContainPass = !fallbackDetected
    && (mustContain.length === 0 || mustContain.some((term) => summary.includes(term)));
  const summaryMustNotContainPass = !fallbackDetected
    && mustNotContain.every((term) => !summary.includes(term));
  const moderationActionPass = !fallbackDetected
    && (!expectedModerationAction || expectedModerationAction === predictedModerationAction);

  return {
    id: example.id,
    tp,
    fp,
    fn,
    precision: p,
    recall: r,
    f1: scoreF1,
    expectedMediaType: expectedMediaType || null,
    predictedMediaType: predictedMediaType || null,
    expectedModerationAction: expectedModerationAction || null,
    predictedModerationAction: predictedModerationAction || null,
    mediaTypePass,
    moderationActionPass,
    summaryMustContainPass,
    summaryMustNotContainPass,
    confidence: Number(prediction.confidence ?? 0),
    cautionFlags: Array.isArray(prediction.cautionFlags) ? prediction.cautionFlags : [],
    fallbackDetected,
  };
}

export function buildReport(datasetPath, baseUrl, perExample, minConfidence, options = {}) {
  const successful = perExample.filter((x) => !x.error).length;
  const total = perExample.length;
  const evaluated = perExample.filter((x) => !x.error);
  const nonFallback = evaluated.filter((x) => !x.fallbackDetected);
  const fallbackCount = evaluated.length - nonFallback.length;
  const inlineFixtureCount = perExample.filter((x) => x.inputMode === 'inline-fixture').length;
  const remoteUrlCount = perExample.filter((x) => x.inputMode === 'remote-url').length;

  const totalTp = evaluated.reduce((sum, item) => sum + (item.tp ?? 0), 0);
  const totalFp = evaluated.reduce((sum, item) => sum + (item.fp ?? 0), 0);
  const totalFn = evaluated.reduce((sum, item) => sum + (item.fn ?? 0), 0);
  const entityPrecision = precision(totalTp, totalFp);
  const entityRecall = recall(totalTp, totalFn);
  const entityF1 = f1(entityPrecision, entityRecall);

  const modelOnlyTp = nonFallback.reduce((sum, item) => sum + (item.tp ?? 0), 0);
  const modelOnlyFp = nonFallback.reduce((sum, item) => sum + (item.fp ?? 0), 0);
  const modelOnlyFn = nonFallback.reduce((sum, item) => sum + (item.fn ?? 0), 0);
  const modelOnlyPrecision = precision(modelOnlyTp, modelOnlyFp);
  const modelOnlyRecall = recall(modelOnlyTp, modelOnlyFn);
  const modelOnlyF1 = f1(modelOnlyPrecision, modelOnlyRecall);

  const mediaTypePassed = evaluated.filter((item) => item.mediaTypePass).length;
  const summaryContainPassed = evaluated.filter((item) => item.summaryMustContainPass).length;
  const summaryNotContainPassed = evaluated.filter((item) => item.summaryMustNotContainPass).length;
  const moderationActionPassed = evaluated.filter((item) => item.moderationActionPass).length;
  const minConfidencePassed = evaluated.filter((item) => (item.confidence ?? 0) >= minConfidence).length;

  const modelOnlyMediaTypePassed = nonFallback.filter((item) => item.mediaTypePass).length;
  const modelOnlySummaryContainPassed = nonFallback.filter((item) => item.summaryMustContainPass).length;
  const modelOnlySummaryNotContainPassed = nonFallback.filter((item) => item.summaryMustNotContainPass).length;
  const modelOnlyModerationActionPassed = nonFallback.filter((item) => item.moderationActionPass).length;

  return {
    baseUrl,
    dataset: datasetPath,
    ...(options.runtimeProbe ? { runtimeProbe: options.runtimeProbe } : {}),
    totals: {
      successful,
      failed: total - successful,
      total,
      analyzed: nonFallback.length,
      fallback: fallbackCount,
      inputModes: {
        inlineFixture: inlineFixtureCount,
        remoteUrl: remoteUrlCount,
      },
    },
    entityMetrics: {
      precision: Number(entityPrecision.toFixed(4)),
      recall: Number(entityRecall.toFixed(4)),
      f1: Number(entityF1.toFixed(4)),
      tp: totalTp,
      fp: totalFp,
      fn: totalFn,
    },
    modelOnlyEntityMetrics: {
      precision: Number(modelOnlyPrecision.toFixed(4)),
      recall: Number(modelOnlyRecall.toFixed(4)),
      f1: Number(modelOnlyF1.toFixed(4)),
      tp: modelOnlyTp,
      fp: modelOnlyFp,
      fn: modelOnlyFn,
    },
    structuralChecks: {
      analysisCoverage: total > 0 ? Number((nonFallback.length / total).toFixed(4)) : 0,
      mediaTypeAccuracy: total > 0 ? Number((mediaTypePassed / total).toFixed(4)) : 0,
      moderationActionAccuracy: total > 0 ? Number((moderationActionPassed / total).toFixed(4)) : 0,
      summaryMustContainRate: total > 0 ? Number((summaryContainPassed / total).toFixed(4)) : 0,
      summaryMustNotContainRate: total > 0 ? Number((summaryNotContainPassed / total).toFixed(4)) : 0,
      fallbackRate: total > 0 ? Number((fallbackCount / total).toFixed(4)) : 0,
      minConfidenceRate: total > 0 ? Number((minConfidencePassed / total).toFixed(4)) : 0,
      modelOnlyMediaTypeAccuracy: nonFallback.length > 0 ? Number((modelOnlyMediaTypePassed / nonFallback.length).toFixed(4)) : 0,
      modelOnlyModerationActionAccuracy: nonFallback.length > 0 ? Number((modelOnlyModerationActionPassed / nonFallback.length).toFixed(4)) : 0,
      modelOnlySummaryMustContainRate: nonFallback.length > 0 ? Number((modelOnlySummaryContainPassed / nonFallback.length).toFixed(4)) : 0,
      modelOnlySummaryMustNotContainRate: nonFallback.length > 0 ? Number((modelOnlySummaryNotContainPassed / nonFallback.length).toFixed(4)) : 0,
    },
    perExample,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = await readDataset(args.dataset);
  const inlineProbe = usesInlineFixtures(dataset)
    ? await probeInlineModelBackend()
    : null;

  if (inlineProbe && !inlineProbe.reachable) {
    const unavailableExamples = dataset.map((row) => ({
      id: row.id,
      error: `inline multimodal backend unavailable: ${inlineProbe.error ?? 'probe failed'}`,
      inputMode: 'inline-fixture',
    }));
    const report = buildReport(
      args.dataset,
      args.baseUrl,
      unavailableExamples,
      args.minConfidence,
      {
        runtimeProbe: {
          inlineModelBackend: inlineProbe,
        },
      },
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 5;
    return;
  }

  const perExample = [];

  for (const row of dataset) {
    let prediction;
    try {
      prediction = await analyzeExample(args.baseUrl, row.request, args.timeoutMs, args.retries);
    } catch (error) {
      perExample.push({
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

      const evaluated = evaluateExample(row, prediction);
      perExample.push({
        ...evaluated,
        inputMode: typeof row.request?.inlineImagePath === 'string' && row.request.inlineImagePath.trim()
          ? 'inline-fixture'
          : 'remote-url',
      });
  }
  const report = buildReport(
    args.dataset,
    args.baseUrl,
    perExample,
    args.minConfidence,
    inlineProbe
      ? {
          runtimeProbe: {
            inlineModelBackend: inlineProbe,
          },
        }
      : undefined,
  );

  console.log(JSON.stringify(report, null, 2));

  if (report.totals.failed > 0) {
    process.exitCode = 2;
    return;
  }

  if (args.requireNonFallback && report.totals.fallback > 0) {
    console.error(
      `multimodal eval failed strict check: fallback responses detected (${report.totals.fallback}/${report.totals.total})`,
    );
    process.exitCode = 3;
    return;
  }

  if (args.requireNonFallback && report.structuralChecks.minConfidenceRate < 1) {
    const belowThreshold = report.totals.total - Math.round(report.structuralChecks.minConfidenceRate * report.totals.total);
    console.error(
      `multimodal eval failed strict check: confidence below threshold ${args.minConfidence} for ${belowThreshold} case(s)`,
    );
    process.exitCode = 4;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  main().catch((error) => {
    console.error('multimodal eval failed');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

export {
  evaluateExample,
  isLikelyFallbackResponse,
  parseArgs,
  probeInlineModelBackend,
  usesInlineFixtures,
};
