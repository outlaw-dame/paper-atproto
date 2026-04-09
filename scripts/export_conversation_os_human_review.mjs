#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildConversationOsReport, normalizeFixtureIds } from './eval_conversation_os.mjs';
import { createHumanReviewPack } from './conversation_os_human_review_lib.mjs';

function parseArgs(argv) {
  const args = {
    fixtureIds: null,
    outPath: null,
    reviewerId: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixtures' && argv[index + 1]) {
      args.fixtureIds = normalizeFixtureIds(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--fixtures=')) {
      args.fixtureIds = normalizeFixtureIds(arg.slice('--fixtures='.length));
      continue;
    }
    if (arg === '--out' && argv[index + 1]) {
      args.outPath = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      args.outPath = resolve(arg.slice('--out='.length));
      continue;
    }
    if (arg === '--reviewer' && argv[index + 1]) {
      args.reviewerId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--reviewer=')) {
      args.reviewerId = arg.slice('--reviewer='.length);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildConversationOsReport(args.fixtureIds ?? undefined);
  const pack = createHumanReviewPack(report, {
    reviewerId: args.reviewerId,
  });
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;

  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, serialized, 'utf8');
    console.log(args.outPath);
    return;
  }

  process.stdout.write(serialized);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
