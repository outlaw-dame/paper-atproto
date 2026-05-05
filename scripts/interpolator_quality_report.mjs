#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  const stdout = String(result.stdout ?? '').trim();
  const firstBrace = stdout.indexOf('{');
  const lastBrace = stdout.lastIndexOf('}');
  const json = firstBrace >= 0 && lastBrace > firstBrace
    ? JSON.parse(stdout.slice(firstBrace, lastBrace + 1))
    : null;
  return {
    code: Number(result.status ?? 1),
    json,
    stderr: String(result.stderr ?? '').trim(),
  };
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  return {
    code: Number(result.status ?? 1),
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}

function ratio(passed, total) {
  if (!Number.isFinite(passed) || !Number.isFinite(total) || total <= 0) return null;
  return Number((passed / total).toFixed(4));
}

function aggregate(report, target) {
  const value = report?.overall?.[target];
  if (!value) return { passed: 0, total: 0, rate: null };
  return {
    passed: Number(value.passed ?? 0),
    total: Number(value.total ?? 0),
    rate: ratio(Number(value.passed ?? 0), Number(value.total ?? 0)),
  };
}

function testPassed(result) {
  return result.code === 0;
}

function main() {
  const premiumReport = runJson('pnpm', ['run', 'eval:premium-providers', '--', '--json']);
  const stalenessTests = runCommand('pnpm', ['run', 'test', '--', 'src/conversation/coordinatorSourceGuards.test.ts', 'src/conversation/hydrationInvalidation.test.ts', 'src/conversation/sessionAssemblerCoordinatorRuntime.test.ts']);
  const dbTests = runCommand('pnpm', ['run', 'test', '--', 'src/db/runtime.test.ts']);

  const report = {
    generatedAt: new Date().toISOString(),
    premiumEval: premiumReport.json
      ? {
          bootstrap: premiumReport.json.bootstrap ?? null,
          localRaw: aggregate(premiumReport.json, 'local-raw'),
          localShipped: aggregate(premiumReport.json, 'local-shipped'),
          gemini: aggregate(premiumReport.json, 'gemini'),
          openai: aggregate(premiumReport.json, 'openai'),
        }
      : null,
    safeguards: {
      stalenessTestsPassed: testPassed(stalenessTests),
      dbRuntimeTestsPassed: testPassed(dbTests),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.safeguards.stalenessTestsPassed || !report.safeguards.dbRuntimeTestsPassed || !premiumReport.json) {
    process.exitCode = 1;
  }
}

main();