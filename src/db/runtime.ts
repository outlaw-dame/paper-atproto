import { PGlite, type PGliteInterface, type PGliteOptions } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { paperDbExtensions, type PaperDbExtensions } from './extensions';

const PAPER_DB_NAME = 'paper-atproto-db';
const PAPER_DB_MEMORY_URL = `memory://${PAPER_DB_NAME}`;
const PAPER_DB_INDEXEDDB_URL = `idb://${PAPER_DB_NAME}`;
const DEFAULT_PAPER_DB_WORKER_INIT_TIMEOUT_MS = 8_000;

export type PaperDbClient = PGliteInterface<PaperDbExtensions>;

export type PaperDbRuntimeInfo = {
  backend: 'worker' | 'local';
  dataDir: string;
  persistent: boolean;
  relaxedDurability: boolean;
  fallbackReason?: string;
};

type MinimalWorker = {
  terminate: () => void;
};

type RuntimeNavigator = {
  locks?: {
    request?: (...args: unknown[]) => unknown;
  };
};

type RuntimeGlobals = {
  window?: unknown;
  indexedDB?: unknown;
  Worker?: new (scriptUrl: string | URL, options?: { type?: string; name?: string }) => MinimalWorker;
  BroadcastChannel?: new (...args: unknown[]) => unknown;
  navigator?: RuntimeNavigator;
};

type PaperDbClientOptions = Omit<PGliteOptions<PaperDbExtensions>, 'dataDir'>;
type PaperDbWorkerOptions = { dataDir: string; relaxedDurability?: boolean };

type PaperDbRuntimeDeps = {
  env?: Partial<ImportMetaEnv>;
  globals?: RuntimeGlobals;
  isTestRuntime?: boolean;
  workerInitTimeoutMs?: number;
  createWorker?: () => MinimalWorker;
  createWorkerClient?: (worker: MinimalWorker, options: PaperDbWorkerOptions) => Promise<PaperDbClient>;
  createLocalClient?: (dataDir: string, options: PaperDbClientOptions) => Promise<PaperDbClient>;
};

function getImportMetaEnv(): Partial<ImportMetaEnv> {
  return ((import.meta as ImportMeta | undefined)?.env ?? {}) as Partial<ImportMetaEnv>;
}

function getRuntimeGlobals(): RuntimeGlobals {
  return globalThis as unknown as RuntimeGlobals;
}

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (typeof raw !== 'string') return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

function parsePositiveInteger(raw: string | undefined, defaultValue: number): number {
  if (typeof raw !== 'string') return defaultValue;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return defaultValue;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : defaultValue;
}

function isTestRuntime(): boolean {
  return (
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')
    || (typeof import.meta !== 'undefined' && !!(import.meta as { vitest?: unknown }).vitest)
  );
}

function isPersistentBrowserRuntime(globals: RuntimeGlobals): boolean {
  return Boolean(globals.window) && typeof globals.indexedDB !== 'undefined' && globals.indexedDB !== null;
}

export function resolvePaperDbDataDir(
  globals: RuntimeGlobals = getRuntimeGlobals(),
  options: { isTestRuntime?: boolean } = {},
): string {
  if (!isPersistentBrowserRuntime(globals) || (options.isTestRuntime ?? isTestRuntime())) {
    return PAPER_DB_MEMORY_URL;
  }

  return PAPER_DB_INDEXEDDB_URL;
}

export function isPaperDbWorkerEnabled(env: Partial<ImportMetaEnv> = getImportMetaEnv()): boolean {
  return parseBooleanFlag(env.VITE_PGLITE_USE_WORKER, true);
}

export function isPaperDbRelaxedDurabilityEnabled(
  env: Partial<ImportMetaEnv> = getImportMetaEnv(),
): boolean {
  return parseBooleanFlag(env.VITE_PGLITE_RELAXED_DURABILITY, false);
}

export function resolvePaperDbWorkerInitTimeoutMs(
  env: Partial<ImportMetaEnv> = getImportMetaEnv(),
): number {
  return parsePositiveInteger(
    env.VITE_PGLITE_WORKER_INIT_TIMEOUT_MS,
    DEFAULT_PAPER_DB_WORKER_INIT_TIMEOUT_MS,
  );
}

export function isWorkerBackendSupported(globals: RuntimeGlobals = getRuntimeGlobals()): boolean {
  return (
    isPersistentBrowserRuntime(globals)
    && typeof globals.Worker === 'function'
    && typeof globals.BroadcastChannel === 'function'
    && typeof globals.navigator?.locks?.request === 'function'
  );
}

function buildClientOptions(relaxedDurability: boolean): PaperDbClientOptions {
  return {
    extensions: paperDbExtensions,
    ...(relaxedDurability ? { relaxedDurability: true } : {}),
  };
}

function buildWorkerClientOptions(dataDir: string, relaxedDurability: boolean): PaperDbWorkerOptions {
  return {
    dataDir,
    ...(relaxedDurability ? { relaxedDurability: true } : {}),
  };
}

function defaultCreateWorker(): MinimalWorker {
  return new Worker(
    new URL('../workers/pglite.worker.ts', import.meta.url),
    { type: 'module', name: 'paper-db' },
  );
}

async function defaultCreateWorkerClient(
  worker: MinimalWorker,
  options: PaperDbWorkerOptions,
): Promise<PaperDbClient> {
  return (await PGliteWorker.create(worker as unknown as Worker, options)) as unknown as PaperDbClient;
}

async function defaultCreateLocalClient(
  dataDir: string,
  options: PaperDbClientOptions,
): Promise<PaperDbClient> {
  return (await PGlite.create(dataDir, options)) as unknown as PaperDbClient;
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    return normalized ? normalized.slice(0, 240) : error.name;
  }

  return 'Unknown runtime error';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await promise;
  }

  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export async function createPaperDbClient(
  deps: PaperDbRuntimeDeps = {},
): Promise<{ client: PaperDbClient; runtime: PaperDbRuntimeInfo }> {
  const env = deps.env ?? getImportMetaEnv();
  const globals = deps.globals ?? getRuntimeGlobals();
  const dataDir = resolvePaperDbDataDir(
    globals,
    deps.isTestRuntime === undefined ? {} : { isTestRuntime: deps.isTestRuntime },
  );
  const persistent = dataDir.startsWith('idb://');
  const relaxedDurability = persistent && isPaperDbRelaxedDurabilityEnabled(env);
  const clientOptions = buildClientOptions(relaxedDurability);
  const workerClientOptions = buildWorkerClientOptions(dataDir, relaxedDurability);
  const createLocalClient = deps.createLocalClient ?? defaultCreateLocalClient;
  const createWorkerClient = deps.createWorkerClient ?? defaultCreateWorkerClient;
  const createWorker = deps.createWorker ?? defaultCreateWorker;
  const workerInitTimeoutMs = deps.workerInitTimeoutMs ?? resolvePaperDbWorkerInitTimeoutMs(env);
  const workerEnabled = persistent && isPaperDbWorkerEnabled(env);
  const workerSupported = workerEnabled && isWorkerBackendSupported(globals);

  if (workerSupported) {
    let worker: MinimalWorker | null = null;

    try {
      worker = createWorker();
      const client = await withTimeout(
        createWorkerClient(worker, workerClientOptions),
        workerInitTimeoutMs,
        `Worker backend startup timed out after ${workerInitTimeoutMs}ms`,
      );
      return {
        client,
        runtime: {
          backend: 'worker',
          dataDir,
          persistent,
          relaxedDurability,
        },
      };
    } catch (error) {
      worker?.terminate();
      try {
        const client = await createLocalClient(dataDir, clientOptions);
        return {
          client,
          runtime: {
            backend: 'local',
            dataDir,
            persistent,
            relaxedDurability,
            fallbackReason: `Worker backend failed: ${formatRuntimeError(error)}`,
          },
        };
      } catch (fallbackError) {
        throw new AggregateError(
          [error, fallbackError],
          `Worker backend failed and local fallback could not be created`,
        );
      }
    }
  }

  const fallbackReason = persistent
    ? workerEnabled
      ? 'Worker backend unsupported in this runtime'
      : 'Worker backend disabled by configuration'
    : undefined;

  const client = await createLocalClient(dataDir, clientOptions);
  return {
    client,
    runtime: {
      backend: 'local',
      dataDir,
      persistent,
      relaxedDurability,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  };
}
