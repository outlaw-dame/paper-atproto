#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { FACT_CHECK_QUALITY_FIXTURES } from '../src/evals/factCheckQualityFixtures.ts';
import { evaluateFactCheckQuality } from '../src/evals/aiQualityRubric.ts';

const CONTENT_TYPE_HEADER = 'content-type';
const DEFAULT_OUT = 'artifacts/evals/fact-check-quality.json';

function parseArgs(argv) {
  const args = {
    mode: process.env.FACT_CHECK_QUALITY_MODE?.trim() || 'recorded',
    baseUrl: process.env.FACT_CHECK_QUALITY_BASE_URL?.trim() || 'http://127.0.0.1:3011',
    sharedSecret: process.env.VERIFY_SHARED_SECRET?.trim() || '',
    out: DEFAULT_OUT,
    json: false,
    minScore: Number(process.env.FACT_CHECK_QUALITY_MIN_SCORE ?? 0),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--live') {
      args.mode = 'live';
      continue;
    }
    if (arg === '--recorded') {
      args.mode = 'recorded';
      continue;
    }
    if (arg === '--base-url' && argv[index + 1]) {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg === '--out' && argv[index + 1]) {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--min-score' && argv[index + 1]) {
      args.minScore = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--min-score=')) {
      args.minScore = Number(arg.slice('--min-score='.length));
    }
  }

  if (!['recorded', 'live'].includes(args.mode)) {
    throw new Error(`Unsupported fact-check quality mode: ${args.mode}`);
  }

  return args;
}

async function postLiveFactCheck(baseUrl, sharedSecret, fixture) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/verify/fact-check`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      [CONTENT_TYPE_HEADER]: 'application/json',
      ...(sharedSecret ? { 'x-verify-shared-secret': sharedSecret } : {}),
    },
    body: JSON.stringify({
      request: {
        postUri: `eval:${fixture.id}`,
        text: fixture.request.text,
        languageCode: fixture.request.languageCode,
      },
      claims: fixture.request.claims ?? [
        {
          text: fixture.request.text,
          claimType: 'factual_assertion',
          checkability: 0.8,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Fact-check quality request failed with HTTP ${response.status}`);
  }
  return payload;
}

function normalizeFactCheckResult(payload) {
  return {
    matched: Boolean(payload?.matched),
    hits: Array.isArray(payload?.hits) ? payload.hits : [],
    model: typeof payload?.model === 'string' ? payload.model : undefined,
    latencyMs: typeof payload?.latencyMs === 'number' ? payload.latencyMs : undefined,
  };
}

async function evaluateFixture(args, fixture) {
  const startedAt = Date.now();
  try {
    const raw = args.mode === 'live'
      ? await postLiveFactCheck(args.baseUrl, args.sharedSecret, fixture)
      : fixture.recordedResult;
    if (!raw) throw new Error('Fixture is missing recorded fact-check result.');
    const result = normalizeFactCheckResult(raw);
    const quality = evaluateFactCheckQuality(fixture, result);
    return {
      id: fixture.id,
      description: fixture.description,
      mode: args.mode,
      quality,
      result: {
        matched: result.matched,
        hitCount: result.hits.length,
        model: result.model ?? null,
        latencyMs: result.latencyMs ?? Date.now() - startedAt,
      },
    };
  } catch (error) {
    return {
      id: fixture.id,
      description: fixture.description,
      mode: args.mode,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarize(fixtures) {
  const scored = fixtures.filter((fixture) => fixture.quality);
  const averageScore = scored.length === 0
    ? 0
    : scored.reduce((sum, fixture) => sum + fixture.quality.score, 0) / scored.length;
  return {
    fixtureCount: fixtures.length,
    scoredCount: scored.length,
    errorCount: fixtures.length - scored.length,
    averageScore: Math.round(averageScore * 10) / 10,
  };
}

function printHumanReport(report) {
  console.log(`Fact Check quality evaluation (${report.mode})`);
  console.log(`  average quality: ${report.summary.averageScore}/100 across ${report.summary.scoredCount}/${report.summary.fixtureCount} scored fixtures`);
  console.log(`  artifact: ${report.artifact}`);
  console.log('');

  for (const fixture of report.fixtures) {
    if (fixture.error) {
      console.log(`${fixture.id}: ERROR ${fixture.error}`);
      continue;
    }
    console.log(`${fixture.id}: ${fixture.quality.score}/100 ${fixture.quality.grade}`);
    console.log(`  matched=${fixture.result.matched} hits=${fixture.result.hitCount} model=${fixture.result.model ?? 'unknown'} latencyMs=${fixture.result.latencyMs}`);
    for (const component of fixture.quality.components) {
      console.log(`  ${component.id}: ${Math.round(component.score * 100)}% ${JSON.stringify(component.evidence)}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = [];
  for (const fixture of FACT_CHECK_QUALITY_FIXTURES) {
    fixtures.push(await evaluateFixture(args, fixture));
  }

  const outPath = resolve(process.cwd(), args.out);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    baseUrl: args.mode === 'live' ? args.baseUrl : null,
    summary: summarize(fixtures),
    fixtures,
    artifact: outPath,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);

  if (Number.isFinite(args.minScore) && args.minScore > 0 && report.summary.averageScore < args.minScore) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
