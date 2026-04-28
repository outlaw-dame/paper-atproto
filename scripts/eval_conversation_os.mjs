#!/usr/bin/env node

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildConversationOsReport,
  CONVERSATION_OS_EXPECTATIONS,
  evaluateConversationOsProjection,
  normalizeFixtureIds,
} from '../src/evals/conversationOsEval.ts';
import { CONVERSATION_OS_EVAL_SET_META } from '../src/evals/conversationOsFixtures.ts';

function parseArgs(argv) {
  const args = {
    fixtureIds: Object.keys(CONVERSATION_OS_EXPECTATIONS),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--fixtures' && argv[index + 1]) {
      args.fixtureIds = normalizeFixtureIds(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--fixtures=')) {
      args.fixtureIds = normalizeFixtureIds(arg.slice('--fixtures='.length));
    }
  }

  return args;
}

function printHumanReport(report) {
  console.log('Conversation OS substrate evaluation');
  console.log(`${CONVERSATION_OS_EVAL_SET_META.version} • ${CONVERSATION_OS_EVAL_SET_META.provenance}`);
  console.log('');

  for (const fixture of report.fixtures) {
    console.log(`${fixture.id}: ${fixture.description}`);
    console.log(`  summary mode: ${fixture.summaryMode}`);
    console.log(`  change reasons: ${fixture.changeReasons.join(', ') || 'none'}`);
    console.log(`  score: ${fixture.evaluation.passed}/${fixture.evaluation.total} raw • ${fixture.evaluation.weightedPassed}/${fixture.evaluation.weightedTotal} weighted`);
    console.log(`  surfaced contributors: ${fixture.writerInput.topContributors.map((entry) => entry.handle).join(', ') || 'none'}`);
    console.log(`  what changed: ${fixture.writerInput.whatChangedSignals.join(' • ') || 'none'}`);
    console.log(`  context to watch: ${(fixture.writerInput.perspectiveGaps ?? []).join(' • ') || 'none'}`);

    const misses = fixture.evaluation.checks.filter((check) => !check.pass);
    if (misses.length > 0) {
      console.log(`  misses: ${misses.map((check) => check.id).join(', ')}`);
    }
    console.log('');
  }

  console.log('overall:');
  console.log(`  ${report.overall.passed}/${report.overall.total} raw • ${report.overall.weightedPassed}/${report.overall.weightedTotal} weighted`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildConversationOsReport(args.fixtureIds);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}

export {
  buildConversationOsReport,
  CONVERSATION_OS_EXPECTATIONS,
  evaluateConversationOsProjection,
  normalizeFixtureIds,
} from '../src/evals/conversationOsEval.ts';
