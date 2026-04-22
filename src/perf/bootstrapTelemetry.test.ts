import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBootstrapTelemetrySnapshot,
  markBootstrapStageFinished,
  markBootstrapStageStarted,
  resetBootstrapTelemetryForTests,
} from './bootstrapTelemetry';

describe('bootstrapTelemetry', () => {
  beforeEach(() => {
    resetBootstrapTelemetryForTests();
  });

  it('tracks stage lifecycle and sanitizes metadata', () => {
    markBootstrapStageStarted('dbInit');
    markBootstrapStageFinished('dbInit', {
      status: 'passed',
      message: '  Worker-backed local database is ready.  ',
      metadata: {
        backend: 'worker',
        persistent: true,
        ignored: { nested: true },
      },
    });

    const snapshot = getBootstrapTelemetrySnapshot();
    expect(snapshot.dbInit.status).toBe('passed');
    expect(snapshot.dbInit.startedAt).not.toBeNull();
    expect(snapshot.dbInit.finishedAt).not.toBeNull();
    expect(snapshot.dbInit.durationMs).not.toBeNull();
    expect(snapshot.dbInit.message).toBe('Worker-backed local database is ready.');
    expect(snapshot.dbInit.metadata).toEqual({
      backend: 'worker',
      persistent: true,
    });
  });

  it('supports skipped stages without a start marker', () => {
    markBootstrapStageFinished('indexBuild', {
      status: 'skipped',
      message: 'Skipped on low-memory device.',
    });

    const snapshot = getBootstrapTelemetrySnapshot();
    expect(snapshot.indexBuild.status).toBe('skipped');
    expect(snapshot.indexBuild.startedAt).toBeNull();
    expect(snapshot.indexBuild.durationMs).toBeNull();
    expect(snapshot.indexBuild.message).toBe('Skipped on low-memory device.');
  });
});
