import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

const EMBEDDING_DIMS = 16;
const TOP_K = 10;
const DOCS_PER_TOPIC = 250;
const TOPICS = [
  {
    key: 'climate',
    text: 'climate energy emissions carbon policy renewable grid weather adaptation mitigation',
    center: [0.92, 0.84, 0.79, 0.66, 0.42, 0.31, 0.22, 0.19, 0.12, 0.1, 0.06, 0.04, 0.02, 0.01, 0, 0],
  },
  {
    key: 'sports',
    text: 'sports game season playoffs athlete championship coaching roster defense offense',
    center: [0.04, 0.11, 0.08, 0.13, 0.9, 0.85, 0.76, 0.71, 0.62, 0.54, 0.2, 0.12, 0.1, 0.06, 0.02, 0.01],
  },
  {
    key: 'finance',
    text: 'finance market inflation rates bonds stocks banking recession budget treasury',
    center: [0.14, 0.16, 0.11, 0.09, 0.24, 0.19, 0.15, 0.12, 0.88, 0.83, 0.77, 0.69, 0.63, 0.58, 0.51, 0.43],
  },
  {
    key: 'technology',
    text: 'technology software ai machine learning model data infrastructure security developer',
    center: [0.21, 0.28, 0.24, 0.19, 0.26, 0.22, 0.25, 0.18, 0.29, 0.26, 0.88, 0.9, 0.86, 0.74, 0.63, 0.6],
  },
];

const QUERY_CASES = [
  { query: 'climate adaptation energy policy', topic: 'climate' },
  { query: 'renewable grid emissions', topic: 'climate' },
  { query: 'playoffs championship defense', topic: 'sports' },
  { query: 'athlete roster coaching strategy', topic: 'sports' },
  { query: 'inflation rates market volatility', topic: 'finance' },
  { query: 'banking recession budget outlook', topic: 'finance' },
  { query: 'ai model infrastructure security', topic: 'technology' },
  { query: 'developer software data platform', topic: 'technology' },
];

const DEFAULT_CONFIGS = [
  { efSearch: 40, candidateMultiplier: 2 },
  { efSearch: 80, candidateMultiplier: 3 },
  { efSearch: 120, candidateMultiplier: 4 },
];

const AUTO_EF_SEARCH_VALUES = [20, 30, 40, 50, 60, 80, 100, 120, 160, 200];
const AUTO_CANDIDATE_MULTIPLIERS = [1, 2, 3, 4, 5, 6];
const DEFAULT_TARGET_LATENCY_MS = 1.25;
const DEFAULT_AUTO_TOP_RESULTS = 8;

function toVectorLiteral(values) {
  return `[${values.map((value) => Number(value).toFixed(6)).join(',')}]`;
}

function parseFlagArgs(argv) {
  const args = {
    autoTune: false,
    targetLatencyMs: DEFAULT_TARGET_LATENCY_MS,
    topResults: DEFAULT_AUTO_TOP_RESULTS,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '').trim();
    if (!token) continue;

    if (token === '--auto-tune' || token === '--auto') {
      args.autoTune = true;
      continue;
    }

    if (token.startsWith('--target-latency-ms=')) {
      const raw = token.split('=')[1];
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.targetLatencyMs = parsed;
      }
      continue;
    }

    if (token.startsWith('--top=')) {
      const raw = token.split('=')[1];
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.topResults = Math.max(1, Math.floor(parsed));
      }
      continue;
    }
  }

  return args;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeEmbeddingFromCenter(center, jitterSeed) {
  const out = [];
  for (let i = 0; i < EMBEDDING_DIMS; i += 1) {
    const base = center[i] ?? 0;
    const noise = (((jitterSeed * (i + 3)) % 17) - 8) * 0.004;
    out.push(clamp(base + noise, -1, 1));
  }
  return out;
}

function embedQueryText(query) {
  const q = query.toLowerCase();
  const topic = TOPICS.find((entry) => q.includes(entry.key))
    ?? TOPICS.find((entry) => entry.text.split(' ').some((word) => q.includes(word)))
    ?? TOPICS[0];
  return makeEmbeddingFromCenter(topic.center, q.length + topic.key.length);
}

async function seedDatabase(pg) {
  await pg.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE docs (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      search_vector tsvector,
      embedding vector(${EMBEDDING_DIMS})
    );

    CREATE INDEX idx_docs_search_vector ON docs USING GIN(search_vector);
    CREATE INDEX idx_docs_embedding_hnsw ON docs USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  `);

  for (const topic of TOPICS) {
    for (let i = 0; i < DOCS_PER_TOPIC; i += 1) {
      const id = `${topic.key}-${i}`;
      const content = `${topic.text} article ${i} with detailed analysis and community discussion`;
      const embedding = makeEmbeddingFromCenter(topic.center, i + topic.key.length * 13);
      await pg.query(
        `
          INSERT INTO docs (id, topic, content, search_vector, embedding)
          VALUES (
            $1,
            $2,
            $3,
            to_tsvector('english', $3),
            $4::vector
          )
        `,
        [id, topic.key, content, toVectorLiteral(embedding)],
      );
    }
  }
}

function buildHybridSql(candidateLimit) {
  return `
    WITH query_terms AS (
      SELECT websearch_to_tsquery('english', $1) AS q
    ),
    fts_results AS (
      SELECT id,
             ts_rank_cd(search_vector, query_terms.q, 32) AS fts_rank_raw,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, query_terms.q, 32) DESC) AS rank
      FROM docs
      CROSS JOIN query_terms
      WHERE search_vector @@ query_terms.q
      LIMIT ${candidateLimit}
    ),
    semantic_results AS (
      SELECT id,
             (embedding <=> $2::vector) AS semantic_distance,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector ASC) AS rank
      FROM docs
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $2::vector ASC
      LIMIT ${candidateLimit}
    )
    SELECT
      d.id,
      d.topic,
      COALESCE(f.fts_rank_raw, 0.0) AS fts_rank_raw,
      COALESCE(s.semantic_distance, 1.2) AS semantic_distance,
      COALESCE(1.0 / (60 + f.rank), 0.0) + COALESCE(1.0 / (60 + s.rank), 0.0) AS rrf_score
    FROM docs d
    LEFT JOIN fts_results f ON d.id = f.id
    LEFT JOIN semantic_results s ON d.id = s.id
    WHERE f.id IS NOT NULL OR s.id IS NOT NULL
    ORDER BY rrf_score DESC
    LIMIT ${TOP_K};
  `;
}

async function runHybridQuery(pg, { query, candidateMultiplier, efSearch, exact }) {
  const vectorLiteral = toVectorLiteral(embedQueryText(query));
  const candidateLimit = TOP_K * candidateMultiplier;
  const sql = buildHybridSql(candidateLimit);

  const started = performance.now();
  let result;

  if (exact) {
    result = await pg.transaction(async (tx) => {
      await tx.query('SET LOCAL enable_indexscan = off');
      await tx.query('SET LOCAL enable_bitmapscan = off');
      return tx.query(sql, [query, vectorLiteral]);
    });
  } else {
    result = await pg.transaction(async (tx) => {
      await tx.query(`SET LOCAL hnsw.ef_search = ${efSearch}`);
      return tx.query(sql, [query, vectorLiteral]);
    });
  }

  const elapsedMs = performance.now() - started;
  return {
    elapsedMs,
    rows: result.rows ?? [],
  };
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function generateAutoConfigs() {
  const out = [];
  for (const efSearch of AUTO_EF_SEARCH_VALUES) {
    for (const candidateMultiplier of AUTO_CANDIDATE_MULTIPLIERS) {
      out.push({ efSearch, candidateMultiplier });
    }
  }
  return out;
}

function isDominated(a, b) {
  const latencyBetterOrEqual = b.avg_latency_ms <= a.avg_latency_ms;
  const recallBetterOrEqual = b.avg_recall_at_10 >= a.avg_recall_at_10;
  const oneStrict = b.avg_latency_ms < a.avg_latency_ms || b.avg_recall_at_10 > a.avg_recall_at_10;
  return latencyBetterOrEqual && recallBetterOrEqual && oneStrict;
}

function paretoFrontier(rows) {
  return rows.filter((rowA, idxA) => (
    !rows.some((rowB, idxB) => idxA !== idxB && isDominated(rowA, rowB))
  ));
}

function chooseRecommendation(rows, targetLatencyMs) {
  const withinBudget = rows
    .filter((row) => row.avg_latency_ms <= targetLatencyMs)
    .sort((a, b) => {
      if (b.avg_recall_at_10 !== a.avg_recall_at_10) return b.avg_recall_at_10 - a.avg_recall_at_10;
      return a.avg_latency_ms - b.avg_latency_ms;
    });

  if (withinBudget.length > 0) {
    return {
      strategy: 'within-latency-budget',
      targetLatencyMs,
      row: withinBudget[0],
    };
  }

  const bestLatency = [...rows].sort((a, b) => a.avg_latency_ms - b.avg_latency_ms)[0] ?? null;
  return {
    strategy: 'fastest-available',
    targetLatencyMs,
    row: bestLatency,
  };
}

async function evaluateConfig(pg, config, baselineByQuery) {
  const latencySamples = [];
  let totalRecall = 0;

  for (const testcase of QUERY_CASES) {
    const current = await runHybridQuery(pg, {
      query: testcase.query,
      candidateMultiplier: config.candidateMultiplier,
      efSearch: config.efSearch,
      exact: false,
    });

    latencySamples.push(current.elapsedMs);
    totalRecall += overlapRecall(
      baselineByQuery.get(testcase.query) ?? [],
      current.rows,
    );
  }

  return {
    ef_search: config.efSearch,
    candidate_multiplier: config.candidateMultiplier,
    avg_latency_ms: Number(average(latencySamples).toFixed(2)),
    p95_latency_ms: Number(percentile(latencySamples, 0.95).toFixed(2)),
    avg_recall_at_10: Number((totalRecall / QUERY_CASES.length).toFixed(4)),
  };
}

function overlapRecall(referenceRows, candidateRows) {
  const referenceIds = new Set(referenceRows.map((row) => String(row.id)));
  if (referenceIds.size === 0) return 1;

  let overlap = 0;
  for (const row of candidateRows) {
    if (referenceIds.has(String(row.id))) overlap += 1;
  }

  return overlap / referenceIds.size;
}

async function main() {
  const args = parseFlagArgs(process.argv);
  const pg = await PGlite.create({
    dataDir: 'memory://paper-hybrid-benchmark',
    extensions: { vector },
  });

  try {
    await seedDatabase(pg);

    const baselineByQuery = new Map();
    for (const testcase of QUERY_CASES) {
      const baseline = await runHybridQuery(pg, {
        query: testcase.query,
        candidateMultiplier: 8,
        efSearch: 200,
        exact: true,
      });
      baselineByQuery.set(testcase.query, baseline.rows);
    }

    const configs = args.autoTune ? generateAutoConfigs() : DEFAULT_CONFIGS;
    const rows = [];

    for (const config of configs) {
      rows.push(await evaluateConfig(pg, config, baselineByQuery));
    }

    console.log('Hybrid search benchmark summary');
    console.table(rows.slice(0, args.autoTune ? rows.length : DEFAULT_CONFIGS.length));

    if (args.autoTune) {
      const sortedByRecall = [...rows].sort((a, b) => b.avg_recall_at_10 - a.avg_recall_at_10);
      const topRows = sortedByRecall.slice(0, args.topResults);
      const pareto = paretoFrontier(rows)
        .sort((a, b) => a.avg_latency_ms - b.avg_latency_ms)
        .slice(0, args.topResults);
      const recommendation = chooseRecommendation(rows, args.targetLatencyMs);

      console.log('');
      console.log(`Auto-tune: top ${args.topResults} by recall`);
      console.table(topRows);

      console.log(`Auto-tune: Pareto frontier (first ${args.topResults})`);
      console.table(pareto);

      console.log('Auto-tune recommendation');
      if (recommendation.row) {
        console.table([{ strategy: recommendation.strategy, target_latency_ms: recommendation.targetLatencyMs, ...recommendation.row }]);
      } else {
        console.log('No recommendation available (no evaluated rows).');
      }
    }
  } finally {
    await pg.close();
  }
}

main().catch((error) => {
  console.error('[benchmark:hybrid-search] failed', error);
  process.exitCode = 1;
});
