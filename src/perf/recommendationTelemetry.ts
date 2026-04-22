export type RecommendationTelemetryAction = 'dismiss' | 'follow';

export interface RecommendationTelemetryEvent {
  actorDid: string;
  confidence: number;
  reasons: string[];
  source: 'explore-suggested-accounts';
}

export interface RecommendationTelemetrySnapshot {
  impressionCount: number;
  dismissCount: number;
  followCount: number;
  dismissRate: number;
  followConversionRate: number;
  reasonImpressions: Record<string, number>;
  reasonDismisses: Record<string, number>;
  reasonFollows: Record<string, number>;
  confidenceBuckets: Array<{
    bucket: string;
    impressions: number;
    dismisses: number;
    follows: number;
    dismissRate: number;
    followRate: number;
  }>;
}

type ConfidenceBucketId = '0-20' | '20-40' | '40-60' | '60-80' | '80-100';

interface MutableBucket {
  impressions: number;
  dismisses: number;
  follows: number;
}

const BUCKET_ORDER: ConfidenceBucketId[] = ['0-20', '20-40', '40-60', '60-80', '80-100'];

const state = {
  seenImpressionIds: new Set<string>(),
  impressionCount: 0,
  dismissCount: 0,
  followCount: 0,
  reasonImpressions: new Map<string, number>(),
  reasonDismisses: new Map<string, number>(),
  reasonFollows: new Map<string, number>(),
  confidenceBuckets: new Map<ConfidenceBucketId, MutableBucket>(
    BUCKET_ORDER.map((id) => [id, { impressions: 0, dismisses: 0, follows: 0 }]),
  ),
};

function toSafeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function normalizeDid(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeReason(input: string): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 48) : 'Unspecified';
}

function normalizeConfidence(input: number): number {
  if (!Number.isFinite(input)) return 0;
  return Math.max(0, Math.min(1, input));
}

function confidenceBucket(confidence: number): ConfidenceBucketId {
  const pct = Math.round(normalizeConfidence(confidence) * 100);
  if (pct < 20) return '0-20';
  if (pct < 40) return '20-40';
  if (pct < 60) return '40-60';
  if (pct < 80) return '60-80';
  return '80-100';
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function publishSnapshot(): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __GLYMPSE_RECOMMENDATION_METRICS__?: RecommendationTelemetrySnapshot }).__GLYMPSE_RECOMMENDATION_METRICS__ = getRecommendationTelemetrySnapshot();
}

function normalizeEvent(event: RecommendationTelemetryEvent): RecommendationTelemetryEvent {
  return {
    actorDid: normalizeDid(event.actorDid),
    confidence: normalizeConfidence(event.confidence),
    reasons: event.reasons.length > 0
      ? event.reasons.map(normalizeReason).slice(0, 3)
      : ['Unspecified'],
    source: event.source,
  };
}

export function recordRecommendationImpression(event: RecommendationTelemetryEvent): void {
  const normalized = normalizeEvent(event);
  if (!normalized.actorDid.startsWith('did:')) return;
  const dedupeId = `${normalized.source}:${normalized.actorDid}`;
  if (state.seenImpressionIds.has(dedupeId)) return;

  state.seenImpressionIds.add(dedupeId);
  state.impressionCount += 1;
  for (const reason of normalized.reasons) {
    incrementMap(state.reasonImpressions, reason);
  }

  const bucket = confidenceBucket(normalized.confidence);
  const bucketState = state.confidenceBuckets.get(bucket);
  if (bucketState) bucketState.impressions += 1;

  publishSnapshot();
}

export function recordRecommendationAction(
  action: RecommendationTelemetryAction,
  event: RecommendationTelemetryEvent,
): void {
  const normalized = normalizeEvent(event);
  if (!normalized.actorDid.startsWith('did:')) return;

  if (action === 'dismiss') {
    state.dismissCount += 1;
    for (const reason of normalized.reasons) {
      incrementMap(state.reasonDismisses, reason);
    }
  } else {
    state.followCount += 1;
    for (const reason of normalized.reasons) {
      incrementMap(state.reasonFollows, reason);
    }
  }

  const bucket = confidenceBucket(normalized.confidence);
  const bucketState = state.confidenceBuckets.get(bucket);
  if (bucketState) {
    if (action === 'dismiss') bucketState.dismisses += 1;
    else bucketState.follows += 1;
  }

  publishSnapshot();
}

function mapFromCounter(counter: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counter.entries()].sort((a, b) => b[1] - a[1]));
}

export function getRecommendationTelemetrySnapshot(): RecommendationTelemetrySnapshot {
  const confidenceBuckets = BUCKET_ORDER.map((id) => {
    const row = state.confidenceBuckets.get(id) ?? { impressions: 0, dismisses: 0, follows: 0 };
    return {
      bucket: id,
      impressions: row.impressions,
      dismisses: row.dismisses,
      follows: row.follows,
      dismissRate: toSafeRate(row.dismisses, row.impressions),
      followRate: toSafeRate(row.follows, row.impressions),
    };
  });

  return {
    impressionCount: state.impressionCount,
    dismissCount: state.dismissCount,
    followCount: state.followCount,
    dismissRate: toSafeRate(state.dismissCount, state.impressionCount),
    followConversionRate: toSafeRate(state.followCount, state.impressionCount),
    reasonImpressions: mapFromCounter(state.reasonImpressions),
    reasonDismisses: mapFromCounter(state.reasonDismisses),
    reasonFollows: mapFromCounter(state.reasonFollows),
    confidenceBuckets,
  };
}

export function resetRecommendationTelemetryForTests(): void {
  state.seenImpressionIds.clear();
  state.impressionCount = 0;
  state.dismissCount = 0;
  state.followCount = 0;
  state.reasonImpressions.clear();
  state.reasonDismisses.clear();
  state.reasonFollows.clear();
  for (const bucket of state.confidenceBuckets.values()) {
    bucket.impressions = 0;
    bucket.dismisses = 0;
    bucket.follows = 0;
  }
}
