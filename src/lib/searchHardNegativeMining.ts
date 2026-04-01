export interface SearchCorrectionSignal {
  query: string;
  resultId: string;
  relevance: 'relevant' | 'irrelevant';
  confidenceScore: number;
  recordedAt: number;
}

export interface HardNegativeDatasetRow {
  query: string;
  positives: Array<{ id: string; score: number }>;
  negatives: Array<{ id: string; score: number }>;
}

const STORAGE_KEY = 'glympse.search-hard-negative-signals.v1';
const MAX_SIGNALS = 2_000;

function sanitizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function sanitizeResultId(resultId: string): string {
  return resultId.trim().slice(0, 160);
}

function safeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function readSignals(): SearchCorrectionSignal[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchCorrectionSignal[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((signal) => (
      signal
      && typeof signal.query === 'string'
      && typeof signal.resultId === 'string'
      && (signal.relevance === 'relevant' || signal.relevance === 'irrelevant')
      && typeof signal.confidenceScore === 'number'
      && typeof signal.recordedAt === 'number'
    ));
  } catch {
    return [];
  }
}

function writeSignals(signals: SearchCorrectionSignal[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signals.slice(-MAX_SIGNALS)));
  } catch {
    // Best-effort persistence only.
  }
}

export function recordSearchCorrectionSignal(input: {
  query: string;
  resultId: string;
  relevance: 'relevant' | 'irrelevant';
  confidenceScore: number;
}): void {
  const query = sanitizeQuery(input.query);
  const resultId = sanitizeResultId(input.resultId);
  if (!query || !resultId) return;

  const signals = readSignals();
  signals.push({
    query,
    resultId,
    relevance: input.relevance,
    confidenceScore: safeConfidence(input.confidenceScore),
    recordedAt: Date.now(),
  });
  writeSignals(signals);
}

export function buildHardNegativeDataset(maxRows = 400): HardNegativeDatasetRow[] {
  const byQuery = new Map<string, HardNegativeDatasetRow>();

  for (const signal of readSignals()) {
    const row = byQuery.get(signal.query) ?? {
      query: signal.query,
      positives: [],
      negatives: [],
    };

    const target = signal.relevance === 'relevant' ? row.positives : row.negatives;
    if (!target.some((entry) => entry.id === signal.resultId)) {
      target.push({ id: signal.resultId, score: signal.confidenceScore });
    }

    byQuery.set(signal.query, row);
  }

  return [...byQuery.values()]
    .filter((row) => row.positives.length > 0 && row.negatives.length > 0)
    .slice(-Math.max(1, maxRows));
}

export function clearHardNegativeSignals(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
