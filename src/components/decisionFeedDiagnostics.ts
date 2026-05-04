import type {
  DecisionFeedRecord,
  DecisionFeedSnapshot,
} from '../intelligence/coordinator/decisionFeed';

export type DecisionFeedHealthStatus = 'idle' | 'healthy' | 'watch' | 'degraded';

export interface DecisionFeedHealthSummary {
  status: DecisionFeedHealthStatus;
  headline: string;
  details: readonly string[];
  recent: readonly DecisionFeedRecord[];
  totals: {
    records: number;
    droppedSinceReset: number;
    coverageCount: number;
    degradedCount: number;
    premiumUnverifiedCount: number;
    supervisorHoldAllCount: number;
    composerSkipCount: number;
    p95DurationMs: number;
  };
}

const RECENT_LIMIT = 8;

function clampDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function deriveDecisionFeedHealth(
  snapshot: DecisionFeedSnapshot,
): DecisionFeedHealthSummary {
  const records = snapshot.records ?? [];
  const total = records.length;
  if (total === 0) {
    return {
      status: 'idle',
      headline: 'No lane decisions recorded yet.',
      details: [
        'The unified feed is empty; run a composer, premium, or supervisor cycle to populate diagnostics.',
      ],
      recent: [],
      totals: {
        records: 0,
        droppedSinceReset: snapshot.droppedSinceReset,
        coverageCount: 0,
        degradedCount: 0,
        premiumUnverifiedCount: 0,
        supervisorHoldAllCount: 0,
        composerSkipCount: 0,
        p95DurationMs: 0,
      },
    };
  }

  const coverage = new Set(records.map((record) => record.surface));
  const degradedCount = records.filter((record) => record.degraded).length;
  const premiumUnverifiedCount = records.filter((record) => (
    record.summary.kind === 'premium_verification' && record.summary.trust !== 'verified'
  )).length;
  const supervisorHoldAllCount = records.filter((record) => (
    record.summary.kind === 'supervisor_next_step' && record.summary.holdAll
  )).length;
  const composerSkipCount = records.filter((record) => (
    record.summary.kind === 'composer_writer_preflight' && !record.summary.safeToWrite
  )).length;
  const durations = records.map((record) => clampDuration(record.durationMs));
  const p95DurationMs = percentile95(durations);
  const degradedRatio = total > 0 ? degradedCount / total : 0;

  let status: DecisionFeedHealthStatus = 'healthy';
  if (
    supervisorHoldAllCount > 0
    || premiumUnverifiedCount > Math.max(1, Math.floor(total * 0.2))
    || degradedRatio >= 0.35
  ) {
    status = 'degraded';
  } else if (
    coverage.size < 3
    || degradedCount > 0
    || p95DurationMs > 500
  ) {
    status = 'watch';
  }

  const headline = status === 'healthy'
    ? 'Lane decisions are stable and fully covered.'
    : status === 'watch'
      ? 'Lane decisions are visible, but one or more stability signals need attention.'
      : 'Lane decision stability is degraded; hold or unverified patterns are elevated.';

  const details = [
    `Coverage: ${coverage.size}/3 surfaces (${Array.from(coverage).join(', ') || 'none'}).`,
    `Degraded plans: ${degradedCount}/${total} (${formatPct(degradedCount, total)}).`,
    `Premium unverified/hold decisions: ${premiumUnverifiedCount}/${total}.`,
    `Supervisor hold-all decisions: ${supervisorHoldAllCount}/${total}.`,
    `Composer preflight skips: ${composerSkipCount}/${total}.`,
    `p95 lane duration: ${Math.round(p95DurationMs)} ms.`,
    ...(snapshot.droppedSinceReset > 0
      ? [`Dropped oldest records since reset: ${snapshot.droppedSinceReset}.`]
      : []),
  ];

  return {
    status,
    headline,
    details,
    recent: records.slice(-RECENT_LIMIT).reverse(),
    totals: {
      records: total,
      droppedSinceReset: snapshot.droppedSinceReset,
      coverageCount: coverage.size,
      degradedCount,
      premiumUnverifiedCount,
      supervisorHoldAllCount,
      composerSkipCount,
      p95DurationMs,
    },
  };
}
