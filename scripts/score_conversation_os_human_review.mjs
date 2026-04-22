#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { scoreHumanReviewPack } from './conversation_os_human_review_lib.mjs';

function parseArgs(argv) {
  const args = {
    filePath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file' && argv[index + 1]) {
      args.filePath = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--file=')) {
      args.filePath = resolve(arg.slice('--file='.length));
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    throw new Error('Missing --file path to a completed human review pack.');
  }

  const raw = await readFile(args.filePath, 'utf8');
  const pack = JSON.parse(raw);
  pack.meta = {
    ...(typeof pack.meta === 'object' && pack.meta !== null ? pack.meta : {}),
    sourcePath: args.filePath,
  };

  process.stdout.write(`${JSON.stringify(scoreHumanReviewPack(pack), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
