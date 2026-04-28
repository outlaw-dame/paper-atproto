type EmbeddingTelemetrySnapshot = {
  queryEmbeddings: number;
  ingestEmbeddings: number;
  filterEmbeddings: number;
  rollingCentroidDrift: number;
  averageVectorNorm: number;
  observedVectors: number;
};

const state = {
  queryEmbeddings: 0,
  ingestEmbeddings: 0,
  filterEmbeddings: 0,
  rollingCentroidDrift: 0,
  averageVectorNorm: 0,
  observedVectors: 0,
  centroid: [] as number[],
};

const DRIFT_ALPHA = 0.12;

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
}

function cosineDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }

  if (aNorm === 0 || bNorm === 0) return 0;
  const cosine = dot / Math.sqrt(aNorm * bNorm);
  return Math.max(0, Math.min(2, 1 - cosine));
}

function publish(): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __GLYMPSE_EMBEDDING_METRICS__?: EmbeddingTelemetrySnapshot }).__GLYMPSE_EMBEDDING_METRICS__ = getEmbeddingTelemetrySnapshot();
}

export function recordEmbeddingVector(mode: 'query' | 'ingest' | 'filter', vector: number[]): void {
  if (vector.length === 0) return;

  if (mode === 'query') state.queryEmbeddings += 1;
  if (mode === 'ingest') state.ingestEmbeddings += 1;
  if (mode === 'filter') state.filterEmbeddings += 1;

  const nextNorm = norm(vector);
  state.averageVectorNorm = state.observedVectors === 0
    ? nextNorm
    : ((state.averageVectorNorm * state.observedVectors) + nextNorm) / (state.observedVectors + 1);

  if (state.centroid.length === 0) {
    state.centroid = [...vector];
    state.rollingCentroidDrift = 0;
    state.observedVectors += 1;
    publish();
    return;
  }

  const drift = cosineDistance(vector, state.centroid);
  state.rollingCentroidDrift = state.rollingCentroidDrift === 0
    ? drift
    : (1 - DRIFT_ALPHA) * state.rollingCentroidDrift + DRIFT_ALPHA * drift;

  const len = Math.min(state.centroid.length, vector.length);
  for (let i = 0; i < len; i += 1) {
    state.centroid[i] = (1 - DRIFT_ALPHA) * (state.centroid[i] ?? 0) + DRIFT_ALPHA * (vector[i] ?? 0);
  }

  state.observedVectors += 1;
  publish();
}

export function getEmbeddingTelemetrySnapshot(): EmbeddingTelemetrySnapshot {
  return {
    queryEmbeddings: state.queryEmbeddings,
    ingestEmbeddings: state.ingestEmbeddings,
    filterEmbeddings: state.filterEmbeddings,
    rollingCentroidDrift: state.rollingCentroidDrift,
    averageVectorNorm: state.averageVectorNorm,
    observedVectors: state.observedVectors,
  };
}
