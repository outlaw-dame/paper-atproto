import { paperDB } from '../db';
import type { PaperDbRuntimeInfo } from '../db/runtime';
import { inferenceClient } from '../workers/InferenceClient';

const DB_SMOKE_TIMEOUT_MS = 4_000;
const BROWSER_ML_SMOKE_TIMEOUT_MS = 6_000;

export type RuntimeSmokeState = 'idle' | 'running' | 'passed' | 'failed';

export type RuntimeSmokeTargetReport = {
  state: Exclude<RuntimeSmokeState, 'idle' | 'running'>;
  checkedAt: number;
  message: string;
  backend?: PaperDbRuntimeInfo['backend'];
  persistent?: boolean;
  workerStatus?: string;
  crossOriginIsolated?: boolean;
  assetIntegrityOk?: boolean;
};

export type RuntimeSmokeReport = {
  overallState: Exclude<RuntimeSmokeState, 'idle' | 'running'>;
  lastRunAt: number;
  db: RuntimeSmokeTargetReport;
  browserMl: RuntimeSmokeTargetReport;
};

type RuntimeSmokeDeps = {
  now?: () => number;
  checkDb?: () => Promise<RuntimeSmokeTargetReport>;
  checkBrowserMl?: () => Promise<RuntimeSmokeTargetReport>;
};

function formatSmokeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors
      .map((entry) => formatSmokeError(entry))
      .filter(Boolean)
      .join(' ');
    return details || error.message;
  }

  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, ' ').trim();
    return message ? message.slice(0, 240) : error.name;
  }

  return 'Unknown runtime error';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

async function defaultCheckDb(now: () => number): Promise<RuntimeSmokeTargetReport> {
  try {
    await withTimeout(
      paperDB.init(),
      DB_SMOKE_TIMEOUT_MS,
      `Local database startup timed out after ${DB_SMOKE_TIMEOUT_MS}ms`,
    );
    const info = paperDB.getRuntimeInfo();
    const checkedAt = now();
    const message = info.backend === 'worker'
      ? 'Worker-backed local database is ready.'
      : info.fallbackReason
        ? `Local database is ready using the in-thread fallback. ${info.fallbackReason}`
        : 'In-thread local database is ready.';

    return {
      state: 'passed',
      checkedAt,
      message,
      backend: info.backend,
      persistent: info.persistent,
    };
  } catch (error) {
    return {
      state: 'failed',
      checkedAt: now(),
      message: `Local database smoke check failed. ${formatSmokeError(error)}`,
    };
  }
}

async function defaultCheckBrowserMl(now: () => number): Promise<RuntimeSmokeTargetReport> {
  try {
    const result = await inferenceClient.runSmokeCheck(BROWSER_ML_SMOKE_TIMEOUT_MS);
    const checkedAt = now();
    const privacySafe = result.allowLocalModels === true && result.allowRemoteModels === false;
    const assetsReady = result.assetIntegrityOk === true;

    if (!privacySafe) {
      return {
        state: 'failed',
        checkedAt,
        message: 'Browser ML runtime is misconfigured: local models must stay enabled and remote model fetches must stay disabled.',
        workerStatus: result.status,
        crossOriginIsolated: result.crossOriginIsolated,
        assetIntegrityOk: assetsReady,
      };
    }

    if (!assetsReady) {
      return {
        state: 'failed',
        checkedAt,
        message: `Browser ML worker started, but local model assets could not be verified. ${result.assetError ?? 'Missing embedding assets.'}`.trim(),
        workerStatus: result.status,
        crossOriginIsolated: result.crossOriginIsolated,
        assetIntegrityOk: assetsReady,
      };
    }

    const capabilitySuffix = result.crossOriginIsolated
      ? 'Cross-origin isolation is available for the worker runtime.'
      : 'Cross-origin isolation is not enabled, but the runtime remains in the single-threaded safe path.';

    return {
      state: 'passed',
      checkedAt,
      message: `Browser ML worker started and local model assets are reachable. ${capabilitySuffix}`,
      workerStatus: result.status,
      crossOriginIsolated: result.crossOriginIsolated,
      assetIntegrityOk: assetsReady,
    };
  } catch (error) {
    return {
      state: 'failed',
      checkedAt: now(),
      message: `Browser ML smoke check failed. ${formatSmokeError(error)}`,
    };
  }
}

export async function runRuntimeSmokeCheck(
  deps: RuntimeSmokeDeps = {},
): Promise<RuntimeSmokeReport> {
  const now = deps.now ?? (() => Date.now());
  const checkDb = deps.checkDb ?? (() => defaultCheckDb(now));
  const checkBrowserMl = deps.checkBrowserMl ?? (() => defaultCheckBrowserMl(now));

  const [db, browserMl] = await Promise.all([
    checkDb(),
    checkBrowserMl(),
  ]);

  const overallState = db.state === 'passed' && browserMl.state === 'passed'
    ? 'passed'
    : 'failed';

  return {
    overallState,
    lastRunAt: now(),
    db,
    browserMl,
  };
}
