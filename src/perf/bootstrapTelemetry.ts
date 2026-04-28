export type BootstrapStageName =
  | 'dbInit'
  | 'migrations'
  | 'runtimeProbe'
  | 'runtimeSmoke'
  | 'indexBuild';

export type BootstrapStageStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped';

export interface BootstrapStageSnapshot {
  status: BootstrapStageStatus;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  message: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface BootstrapTelemetrySnapshot {
  dbInit: BootstrapStageSnapshot;
  migrations: BootstrapStageSnapshot;
  runtimeProbe: BootstrapStageSnapshot;
  runtimeSmoke: BootstrapStageSnapshot;
  indexBuild: BootstrapStageSnapshot;
}

const STAGES: BootstrapStageName[] = [
  'dbInit',
  'migrations',
  'runtimeProbe',
  'runtimeSmoke',
  'indexBuild',
];

const state: Record<BootstrapStageName, BootstrapStageSnapshot> = {
  dbInit: emptyStage(),
  migrations: emptyStage(),
  runtimeProbe: emptyStage(),
  runtimeSmoke: emptyStage(),
  indexBuild: emptyStage(),
};

function emptyStage(): BootstrapStageSnapshot {
  return {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    message: null,
    metadata: {},
  };
}

function sanitizeMessage(input: string | null | undefined): string | null {
  const cleaned = String(input ?? '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 240) : null;
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  if (!metadata) return {};

  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value.slice(0, 120);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function snapshot(): BootstrapTelemetrySnapshot {
  return {
    dbInit: { ...state.dbInit, metadata: { ...state.dbInit.metadata } },
    migrations: { ...state.migrations, metadata: { ...state.migrations.metadata } },
    runtimeProbe: { ...state.runtimeProbe, metadata: { ...state.runtimeProbe.metadata } },
    runtimeSmoke: { ...state.runtimeSmoke, metadata: { ...state.runtimeSmoke.metadata } },
    indexBuild: { ...state.indexBuild, metadata: { ...state.indexBuild.metadata } },
  };
}

function publishSnapshot(): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __PAPER_BOOTSTRAP_DEBUG__?: BootstrapTelemetrySnapshot }).__PAPER_BOOTSTRAP_DEBUG__ = snapshot();
}

export function markBootstrapStageStarted(stage: BootstrapStageName): void {
  const nextStartedAt = Date.now();
  state[stage] = {
    ...state[stage],
    status: 'running',
    startedAt: nextStartedAt,
    finishedAt: null,
    durationMs: null,
    message: null,
  };
  publishSnapshot();
}

export function markBootstrapStageFinished(
  stage: BootstrapStageName,
  options: {
    status: Exclude<BootstrapStageStatus, 'idle' | 'running'>;
    message?: string | null;
    metadata?: Record<string, unknown>;
  },
): void {
  const startedAt = state[stage].startedAt;
  const finishedAt = Date.now();
  state[stage] = {
    status: options.status,
    startedAt,
    finishedAt,
    durationMs: startedAt === null ? null : Math.max(0, finishedAt - startedAt),
    message: sanitizeMessage(options.message),
    metadata: sanitizeMetadata(options.metadata),
  };
  publishSnapshot();
}

export function getBootstrapTelemetrySnapshot(): BootstrapTelemetrySnapshot {
  return snapshot();
}

export function resetBootstrapTelemetryForTests(): void {
  for (const stage of STAGES) {
    state[stage] = emptyStage();
  }
  publishSnapshot();
}
