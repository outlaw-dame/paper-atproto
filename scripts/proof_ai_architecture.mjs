#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  assertAiArchitectureProofReport,
  buildAiArchitectureProofReport,
} from '../src/evals/aiArchitectureProof.ts';

function parseArgs(argv) {
  const args = {
    json: false,
    out: 'artifacts/proofs/ai-architecture-proof.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--out' && argv[index + 1]) {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length);
    }
  }

  return args;
}

function printHumanSummary(report, outPath) {
  console.log('AI architecture proof report');
  console.log(`  proofs: ${report.summary.passed}/${report.summary.total} passed`);
  console.log(`  artifact: ${outPath}`);
  console.log('');

  for (const proof of report.proofs) {
    const status = proof.passed ? 'PASS' : 'FAIL';
    console.log(`${status} ${proof.id}`);
    console.log(`  invariant: ${proof.invariant}`);
    console.log(`  evidence: ${JSON.stringify(proof.evidence)}`);
    if (proof.failure) {
      console.log(`  failure: ${proof.failure}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildAiArchitectureProofReport();
  const outPath = resolve(process.cwd(), args.out);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report, outPath);
  }

  assertAiArchitectureProofReport(report);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
