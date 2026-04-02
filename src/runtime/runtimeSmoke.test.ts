import { describe, expect, it } from 'vitest';
import { runRuntimeSmokeCheck } from './runtimeSmoke';

describe('runRuntimeSmokeCheck', () => {
  it('reports success when both checks pass', async () => {
    const report = await runRuntimeSmokeCheck({
      now: () => 1234,
      checkDb: async () => ({
        state: 'passed',
        checkedAt: 1234,
        message: 'db ok',
        backend: 'worker',
        persistent: true,
      }),
      checkBrowserMl: async () => ({
        state: 'passed',
        checkedAt: 1234,
        message: 'ml ok',
        workerStatus: 'idle',
        crossOriginIsolated: false,
        assetIntegrityOk: true,
      }),
    });

    expect(report.overallState).toBe('passed');
    expect(report.lastRunAt).toBe(1234);
  });

  it('reports failure when either smoke target fails', async () => {
    const report = await runRuntimeSmokeCheck({
      now: () => 4321,
      checkDb: async () => ({
        state: 'passed',
        checkedAt: 4321,
        message: 'db ok',
      }),
      checkBrowserMl: async () => ({
        state: 'failed',
        checkedAt: 4321,
        message: 'ml failed',
      }),
    });

    expect(report.overallState).toBe('failed');
    expect(report.browserMl.message).toBe('ml failed');
  });
});
