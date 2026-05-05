#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    strictPremium: false,
    minConversationWeighted: 0.99,
    minMultimodalEntityPrecision: 0.72,
    minMultimodalEntityF1: 0.75,
    minMultimodalSummaryContain: 0.9,
    maxMultimodalFallbackRate: 0.2,
    minPremiumPassRate: 0.8,
    minLocalShippedPassRate: 0.85,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict-premium') {
      args.strictPremium = true;
      continue;
    }
    if (arg.startsWith('--min-conversation-weighted=')) {
      args.minConversationWeighted = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--min-multimodal-precision=')) {
      args.minMultimodalEntityPrecision = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--min-multimodal-f1=')) {
      args.minMultimodalEntityF1 = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--min-multimodal-summary=')) {
      args.minMultimodalSummaryContain = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--max-multimodal-fallback=')) {
      args.maxMultimodalFallbackRate = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--min-premium-pass-rate=')) {
      args.minPremiumPassRate = Number(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--min-local-shipped-pass-rate=')) {
      args.minLocalShippedPassRate = Number(arg.split('=')[1]);
      continue;
    }
  }

  return args;
}

function extractJson(stdout, fallbackLabel) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) {
    throw new Error(`${fallbackLabel} produced no output`);
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error(`${fallbackLabel} did not produce parseable JSON`);
  }
  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(candidate);
}

function runJsonCommand(label, command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const code = Number(result.status ?? 1);

  let json = null;
  let parseError = null;
  try {
    json = extractJson(stdout, label);
  } catch (error) {
    parseError = error;
  }

  return {
    label,
    code,
    stdout,
    stderr,
    json,
    parseError,
  };
}

function clampRate(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function summarizeResult(name, passed, actual, expected, mode = '>=') {
  const comparator = mode === '<=' ? '<=' : '>=';
  return {
    name,
    passed,
    comparator,
    actual: Number(actual.toFixed(4)),
    expected: Number(expected.toFixed(4)),
  };
}

function evaluateConversation(report, thresholds) {
  const weightedPassed = Number(report?.overall?.weightedPassed ?? 0);
  const weightedTotal = Number(report?.overall?.weightedTotal ?? 0);
  const weightedRate = clampRate(ratio(weightedPassed, weightedTotal));

  return [
    summarizeResult(
      'conversation.weightedRate',
      weightedRate >= thresholds.minConversationWeighted,
      weightedRate,
      thresholds.minConversationWeighted,
      '>=',
    ),
  ];
}

function evaluateMultimodal(report, thresholds) {
  if (isMultimodalRuntimeUnavailable(report)) {
    return [
      summarizeResult(
        'multimodal.runtimeUnavailableSkip',
        true,
        1,
        1,
        '>=',
      ),
    ];
  }

  const entityPrecision = clampRate(Number(report?.entityMetrics?.precision ?? 0));
  const entityF1 = clampRate(Number(report?.entityMetrics?.f1 ?? 0));
  const summaryContainRate = clampRate(Number(report?.structuralChecks?.summaryMustContainRate ?? 0));
  const fallbackRate = clampRate(Number(report?.structuralChecks?.fallbackRate ?? 1));

  return [
    summarizeResult(
      'multimodal.entityPrecision',
      entityPrecision >= thresholds.minMultimodalEntityPrecision,
      entityPrecision,
      thresholds.minMultimodalEntityPrecision,
      '>=',
    ),
    summarizeResult(
      'multimodal.entityF1',
      entityF1 >= thresholds.minMultimodalEntityF1,
      entityF1,
      thresholds.minMultimodalEntityF1,
      '>=',
    ),
    summarizeResult(
      'multimodal.summaryMustContainRate',
      summaryContainRate >= thresholds.minMultimodalSummaryContain,
      summaryContainRate,
      thresholds.minMultimodalSummaryContain,
      '>=',
    ),
    summarizeResult(
      'multimodal.fallbackRate',
      fallbackRate <= thresholds.maxMultimodalFallbackRate,
      fallbackRate,
      thresholds.maxMultimodalFallbackRate,
      '<=',
    ),
  ];
}

function isMultimodalRuntimeUnavailable(report) {
  const inlineBackend = report?.runtimeProbe?.inlineModelBackend;
  if (!inlineBackend || inlineBackend.reachable !== false) return false;

  const totals = report?.totals ?? {};
  const total = Number(totals.total ?? 0);
  const analyzed = Number(totals.analyzed ?? 0);
  const failed = Number(totals.failed ?? 0);
  if (total <= 0 || analyzed !== 0 || failed !== total) return false;

  const examples = Array.isArray(report?.perExample) ? report.perExample : [];
  return examples.length === total && examples.every((entry) => (
    typeof entry?.error === 'string' &&
    entry.error.includes('inline multimodal backend unavailable')
  ));
}

function evaluatePremium(report, thresholds) {
  const local = report?.overall?.['local-shipped'] ?? { passed: 0, total: 0 };
  const localRate = clampRate(ratio(Number(local.passed ?? 0), Number(local.total ?? 0)));
  const bootstrap = report?.bootstrap ?? null;

  if (bootstrap && bootstrap.serverReachable === false) {
    return [
      {
        name: 'premium.bootstrap.serverReachable',
        passed: false,
        comparator: '>=',
        actual: 0,
        expected: 1,
      },
    ];
  }

  const premiumTargets = ['gemini', 'openai'];
  const premiumRates = premiumTargets.map((target) => {
    const aggregate = report?.overall?.[target] ?? { passed: 0, total: 0 };
    return {
      target,
      rate: clampRate(ratio(Number(aggregate.passed ?? 0), Number(aggregate.total ?? 0))),
      total: Number(aggregate.total ?? 0),
    };
  });

  const checks = [
    summarizeResult(
      'premium.localShippedPassRate',
      localRate >= thresholds.minLocalShippedPassRate,
      localRate,
      thresholds.minLocalShippedPassRate,
      '>=',
    ),
  ];

  for (const premium of premiumRates) {
    if (premium.total <= 0) {
      checks.push({
        name: `premium.${premium.target}PassRate`,
        passed: false,
        comparator: '>=',
        actual: 0,
        expected: Number(thresholds.minPremiumPassRate.toFixed(4)),
      });
      continue;
    }

    checks.push(summarizeResult(
      `premium.${premium.target}PassRate`,
      premium.rate >= thresholds.minPremiumPassRate,
      premium.rate,
      thresholds.minPremiumPassRate,
      '>=',
    ));
  }

  return checks;
}

function printSection(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    const status = check.passed ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}] ${check.name}: ${check.actual} ${check.comparator} ${check.expected}`,
    );
  }
}

function diagnosticsForFailure(execResult) {
  const issues = [];
  if (execResult.code !== 0) {
    issues.push(`${execResult.label} exited with code ${execResult.code}`);
  }
  if (execResult.parseError) {
    issues.push(`${execResult.label} JSON parse failed: ${execResult.parseError.message}`);
  }
  return issues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const conversation = runJsonCommand(
    'conversation-os',
    'pnpm',
    ['run', 'eval:conversation-os', '--', '--json'],
  );
  const multimodal = runJsonCommand(
    'multimodal',
    'pnpm',
    ['run', 'eval:multimodal', '--', '--dataset', 'scripts/multimodal_eval_set.sample.jsonl'],
  );
  const premium = args.strictPremium
    ? runJsonCommand(
        'premium-providers',
        'pnpm',
        ['run', 'eval:premium-providers', '--', '--json'],
      )
    : null;

  const failures = [
    ...diagnosticsForFailure(conversation),
    ...diagnosticsForFailure(multimodal),
  ];

  if (args.strictPremium && premium) {
    failures.push(...diagnosticsForFailure(premium));
  }

  if (!conversation.json || !multimodal.json || (args.strictPremium && (!premium || !premium.json))) {
    if (failures.length === 0) {
      failures.push('Unable to parse one or more evaluation reports');
    }
    console.error('Architecture quality gate failed before threshold checks:');
    for (const issue of failures) {
      console.error(`  - ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  const conversationChecks = evaluateConversation(conversation.json, args);
  const multimodalChecks = evaluateMultimodal(multimodal.json, args);
  let premiumChecks = [];

  if (args.strictPremium && premium?.json) {
    premiumChecks = evaluatePremium(premium.json, args);
  } else if (args.strictPremium) {
    premiumChecks = [
      {
        name: 'premium.reportAvailable',
        passed: false,
        comparator: '>=',
        actual: 0,
        expected: 1,
      },
    ];
  }

  printSection('Conversation Quality', conversationChecks);
  printSection('Multimodal Quality', multimodalChecks);
  if (premiumChecks.length > 0) {
    printSection('Premium Quality', premiumChecks);
  } else {
    console.log('\nPremium Quality\n  [WARN] Premium checks are strict-only; run with --strict-premium to enforce provider thresholds.');
  }

  const allChecks = [...conversationChecks, ...multimodalChecks, ...premiumChecks];
  const failedChecks = allChecks.filter((check) => !check.passed);

  if (failedChecks.length > 0) {
    console.error('\nArchitecture quality gate failed.');
    process.exitCode = 1;
    return;
  }

  console.log('\nArchitecture quality gate passed.');
}

main();
