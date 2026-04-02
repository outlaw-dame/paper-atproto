import { describe, expect, it, vi } from 'vitest';
import {
  createPaperDbClient,
  isPaperDbRelaxedDurabilityEnabled,
  isWorkerBackendSupported,
  resolvePaperDbWorkerInitTimeoutMs,
  resolvePaperDbDataDir,
} from './runtime';

function createSupportedGlobals() {
  return {
    window: {},
    indexedDB: {},
    Worker: class FakeWorker {
      terminate() {}
    },
    BroadcastChannel: class FakeBroadcastChannel {},
    navigator: {
      locks: {
        request: vi.fn(),
      },
    },
  };
}

describe('resolvePaperDbDataDir', () => {
  it('uses memory storage outside a persistent browser runtime', () => {
    expect(resolvePaperDbDataDir({})).toBe('memory://paper-atproto-db');
  });
});

describe('isWorkerBackendSupported', () => {
  it('requires the browser worker coordination APIs', () => {
    expect(isWorkerBackendSupported(createSupportedGlobals())).toBe(true);
    expect(
      isWorkerBackendSupported({
        ...createSupportedGlobals(),
        navigator: {},
      }),
    ).toBe(false);
  });
});

describe('isPaperDbRelaxedDurabilityEnabled', () => {
  it('stays opt-in by default', () => {
    expect(isPaperDbRelaxedDurabilityEnabled({})).toBe(false);
    expect(isPaperDbRelaxedDurabilityEnabled({ VITE_PGLITE_RELAXED_DURABILITY: '1' })).toBe(true);
  });
});

describe('resolvePaperDbWorkerInitTimeoutMs', () => {
  it('uses a bounded default and accepts explicit overrides', () => {
    expect(resolvePaperDbWorkerInitTimeoutMs({})).toBe(8_000);
    expect(resolvePaperDbWorkerInitTimeoutMs({ VITE_PGLITE_WORKER_INIT_TIMEOUT_MS: '2500' })).toBe(2_500);
  });
});

describe('createPaperDbClient', () => {
  it('prefers the worker backend when supported', async () => {
    const fakeClient = {} as never;
    const createWorker = vi.fn(() => ({ terminate: vi.fn() }));
    const createWorkerClient = vi.fn(async () => fakeClient);
    const createLocalClient = vi.fn(async () => {
      throw new Error('local fallback should not run');
    });

    const result = await createPaperDbClient({
      isTestRuntime: false,
      globals: createSupportedGlobals(),
      createWorker,
      createWorkerClient,
      createLocalClient,
    });

    expect(result.client).toBe(fakeClient);
    expect(result.runtime.backend).toBe('worker');
    expect(result.runtime.dataDir).toBe('idb://paper-atproto-db');
    expect(result.runtime.relaxedDurability).toBe(false);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorkerClient).toHaveBeenCalledTimes(1);
    expect(createLocalClient).not.toHaveBeenCalled();
  });

  it('falls back once to the local backend if worker startup fails', async () => {
    const worker = { terminate: vi.fn() };
    const fakeClient = {} as never;
    const createLocalClient = vi.fn(async () => fakeClient);

    const result = await createPaperDbClient({
      isTestRuntime: false,
      globals: createSupportedGlobals(),
      createWorker: () => worker,
      createWorkerClient: vi.fn(async () => {
        throw new Error('worker bootstrap failed');
      }),
      createLocalClient,
    });

    expect(result.client).toBe(fakeClient);
    expect(result.runtime.backend).toBe('local');
    expect(result.runtime.fallbackReason).toContain('worker bootstrap failed');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(createLocalClient).toHaveBeenCalledTimes(1);
  });

  it('keeps relaxed durability opt-in and scoped to persistent storage', async () => {
    const capturedOptions: Array<Record<string, unknown>> = [];

    await createPaperDbClient({
      isTestRuntime: false,
      env: { VITE_PGLITE_USE_WORKER: '0', VITE_PGLITE_RELAXED_DURABILITY: '1' },
      globals: createSupportedGlobals(),
      createLocalClient: vi.fn(async (_dataDir, options) => {
        capturedOptions.push(options as Record<string, unknown>);
        return {} as never;
      }),
    });

    expect(capturedOptions[0]?.relaxedDurability).toBe(true);

    capturedOptions.length = 0;

    await createPaperDbClient({
      env: { VITE_PGLITE_RELAXED_DURABILITY: '1' },
      globals: {},
      createLocalClient: vi.fn(async (_dataDir, options) => {
        capturedOptions.push(options as Record<string, unknown>);
        return {} as never;
      }),
    });

    expect(capturedOptions[0]?.relaxedDurability).toBeUndefined();
  });

  it('falls back if worker startup hangs past the timeout', async () => {
    const worker = { terminate: vi.fn() };
    const fakeClient = {} as never;

    const result = await createPaperDbClient({
      isTestRuntime: false,
      globals: createSupportedGlobals(),
      workerInitTimeoutMs: 5,
      createWorker: () => worker,
      createWorkerClient: () => new Promise<never>(() => {}),
      createLocalClient: vi.fn(async () => fakeClient),
    });

    expect(result.client).toBe(fakeClient);
    expect(result.runtime.backend).toBe('local');
    expect(result.runtime.fallbackReason).toContain('startup timed out');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
