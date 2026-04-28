type MultimodalFallbackStage = 'fetch' | 'model-call' | 'parse' | 'validation';
type MultimodalMediaType = 'screenshot' | 'chart' | 'document' | 'photo' | 'meme' | 'unknown';
type MultimodalModerationAction = 'none' | 'warn' | 'blur' | 'drop';

type MultimodalDiagnosticsState = {
  startedAt: string;
  lastUpdatedAt: string;
  invocations: number;
  successes: number;
  usableResults: number;
  rejections: number;
  fallbacks: Record<MultimodalFallbackStage, number>;
  mediaTypeCounts: Record<MultimodalMediaType, number>;
  moderationActionCounts: Record<MultimodalModerationAction, number>;
  confidence: {
    total: number;
    max: number;
    last: number;
    usableTotal: number;
  };
  latencyMs: {
    total: number;
    max: number;
    last: number;
  };
  lastSuccess: {
    at: string;
    mediaType: MultimodalMediaType;
    moderationAction: MultimodalModerationAction;
    confidence: number;
    usable: boolean;
  } | null;
  lastFallback: {
    at: string;
    stage: MultimodalFallbackStage;
    reason: string;
    message: string;
  } | null;
  lastRejection: {
    at: string;
    stage: MultimodalFallbackStage;
    reason: string;
    message: string;
  } | null;
};

const USABLE_CONFIDENCE_THRESHOLD = 0.35;

function nowIso(): string {
  return new Date().toISOString();
}

function clampLatency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function sanitizeMessage(value: string, maxLen = 180): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function createInitialState(): MultimodalDiagnosticsState {
  return {
    startedAt: nowIso(),
    lastUpdatedAt: nowIso(),
    invocations: 0,
    successes: 0,
    usableResults: 0,
    rejections: 0,
    fallbacks: {
      fetch: 0,
      'model-call': 0,
      parse: 0,
      validation: 0,
    },
    mediaTypeCounts: {
      screenshot: 0,
      chart: 0,
      document: 0,
      photo: 0,
      meme: 0,
      unknown: 0,
    },
    moderationActionCounts: {
      none: 0,
      warn: 0,
      blur: 0,
      drop: 0,
    },
    confidence: {
      total: 0,
      max: 0,
      last: 0,
      usableTotal: 0,
    },
    latencyMs: {
      total: 0,
      max: 0,
      last: 0,
    },
    lastSuccess: null,
    lastFallback: null,
    lastRejection: null,
  };
}

let state = createInitialState();

function recordLatency(latencyMs: number): void {
  const safeLatency = clampLatency(latencyMs);
  state.latencyMs.total += safeLatency;
  state.latencyMs.last = safeLatency;
  state.latencyMs.max = Math.max(state.latencyMs.max, safeLatency);
}

export function resetMultimodalDiagnostics(): void {
  state = createInitialState();
}

export function recordMultimodalInvocation(): void {
  state.invocations += 1;
  state.lastUpdatedAt = nowIso();
}

export function recordMultimodalSuccess(params: {
  mediaType: MultimodalMediaType;
  moderationAction: MultimodalModerationAction;
  confidence: number;
  latencyMs: number;
}): void {
  const confidence = clampConfidence(params.confidence);
  const usable = confidence >= USABLE_CONFIDENCE_THRESHOLD;

  state.successes += 1;
  state.lastUpdatedAt = nowIso();
  state.mediaTypeCounts[params.mediaType] += 1;
  state.moderationActionCounts[params.moderationAction] += 1;
  state.confidence.total += confidence;
  state.confidence.last = confidence;
  state.confidence.max = Math.max(state.confidence.max, confidence);
  if (usable) {
    state.usableResults += 1;
    state.confidence.usableTotal += confidence;
  }
  recordLatency(params.latencyMs);
  state.lastSuccess = {
    at: state.lastUpdatedAt,
    mediaType: params.mediaType,
    moderationAction: params.moderationAction,
    confidence,
    usable,
  };
}

export function recordMultimodalFallback(params: {
  stage: MultimodalFallbackStage;
  latencyMs: number;
  reason: string;
  message: string;
}): void {
  state.lastUpdatedAt = nowIso();
  state.fallbacks[params.stage] += 1;
  recordLatency(params.latencyMs);
  state.lastFallback = {
    at: state.lastUpdatedAt,
    stage: params.stage,
    reason: sanitizeMessage(params.reason, 80),
    message: sanitizeMessage(params.message),
  };
}

export function recordMultimodalRejection(params: {
  stage: MultimodalFallbackStage;
  latencyMs: number;
  reason: string;
  message: string;
}): void {
  state.lastUpdatedAt = nowIso();
  state.rejections += 1;
  recordLatency(params.latencyMs);
  state.lastRejection = {
    at: state.lastUpdatedAt,
    stage: params.stage,
    reason: sanitizeMessage(params.reason, 80),
    message: sanitizeMessage(params.message),
  };
}

export function getMultimodalDiagnostics(): Record<string, unknown> {
  const fallbackTotal = Object.values(state.fallbacks).reduce((sum, value) => sum + value, 0);
  const completed = state.successes + fallbackTotal + state.rejections;
  const successRate = state.invocations > 0 ? state.successes / state.invocations : 0;
  const usableRate = state.invocations > 0 ? state.usableResults / state.invocations : 0;
  const fallbackRate = state.invocations > 0 ? fallbackTotal / state.invocations : 0;
  const averageLatency = completed > 0 ? state.latencyMs.total / completed : 0;
  const averageConfidence = state.successes > 0 ? state.confidence.total / state.successes : 0;
  const usableAverageConfidence = state.usableResults > 0
    ? state.confidence.usableTotal / state.usableResults
    : 0;

  return {
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    invocations: state.invocations,
    completed,
    successes: {
      total: state.successes,
      successRate,
    },
    usableResults: {
      total: state.usableResults,
      usableRate,
      threshold: USABLE_CONFIDENCE_THRESHOLD,
    },
    rejections: {
      total: state.rejections,
    },
    fallbacks: {
      ...state.fallbacks,
      total: fallbackTotal,
      fallbackRate,
    },
    mediaTypes: {
      ...state.mediaTypeCounts,
    },
    moderationActions: {
      ...state.moderationActionCounts,
    },
    confidence: {
      average: averageConfidence,
      max: state.confidence.max,
      last: state.confidence.last,
      usableAverage: usableAverageConfidence,
    },
    latencyMs: {
      total: state.latencyMs.total,
      max: state.latencyMs.max,
      last: state.latencyMs.last,
      average: averageLatency,
    },
    ...(state.lastSuccess ? { lastSuccess: state.lastSuccess } : {}),
    ...(state.lastFallback ? { lastFallback: state.lastFallback } : {}),
    ...(state.lastRejection ? { lastRejection: state.lastRejection } : {}),
  };
}
