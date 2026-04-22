import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { input: 'scripts/retrieval_hard_negatives.sample.jsonl' };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function loadRows(filePath) {
  const full = path.resolve(process.cwd(), filePath);
  const content = fs.readFileSync(full, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function evaluateAtThreshold(rows, threshold) {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const row of rows) {
    const positives = Array.isArray(row.positives) ? row.positives : [];
    const negatives = Array.isArray(row.negatives) ? row.negatives : [];

    for (const p of positives) {
      if ((p.score ?? 0) >= threshold) tp += 1;
      else fn += 1;
    }

    for (const n of negatives) {
      if ((n.score ?? 0) >= threshold) fp += 1;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { threshold, precision, recall, f1, tp, fp, fn };
}

function main() {
  const args = parseArgs(process.argv);
  const rows = loadRows(args.input);
  if (rows.length === 0) {
    console.error('No dataset rows found.');
    process.exit(1);
  }

  let best = null;
  for (let t = 0.05; t <= 0.95; t += 0.05) {
    const result = evaluateAtThreshold(rows, Number(t.toFixed(2)));
    if (!best || result.f1 > best.f1) best = result;
  }

  const sorted = [];
  for (let t = 0.05; t <= 0.95; t += 0.05) {
    sorted.push(evaluateAtThreshold(rows, Number(t.toFixed(2))));
  }

  console.log('Hard-negative threshold sweep:');
  for (const row of sorted) {
    console.log(
      `${row.threshold.toFixed(2)}  P=${row.precision.toFixed(3)}  R=${row.recall.toFixed(3)}  F1=${row.f1.toFixed(3)}  TP=${row.tp} FP=${row.fp} FN=${row.fn}`,
    );
  }

  console.log('\nRecommended confidence threshold:');
  console.log(JSON.stringify(best, null, 2));
}

main();
