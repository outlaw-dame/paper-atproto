import { paperDB } from './db';
import { migrateLocalDatabase } from './db/migrations';
import {
  markBootstrapStageFinished,
  markBootstrapStageStarted,
} from './perf/bootstrapTelemetry';
import { initPlatformBootstrap } from './pwa/bootstrap';
import { installExternalLinkGuard } from './lib/safety/externalLinkGuard';
import { getStaticPlatformInfo } from './lib/platformDetect';
// import { inferenceClient } from './workers/InferenceClient';

function shouldSkipVectorIndexBuild(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const { isIOS, isAndroid, isStandalone, deviceMemory } = getStaticPlatformInfo();
  const isLowMemoryDevice = deviceMemory > 0 && deviceMemory <= 4;
  return isIOS || isAndroid || isStandalone || isLowMemoryDevice;
}

/**
 * Initializes the application infrastructure.
 * Call this from main.tsx before rendering the app.
 */
export async function initApp() {
  console.log('[Bootstrap] Initializing...');

  // Apply a global guard so all target=_blank outbound links pass through URL safety checks.
  installExternalLinkGuard();

  // 1. Initialize DB and Extensions
  markBootstrapStageStarted('dbInit');
  try {
    await paperDB.init();
    const runtime = paperDB.getRuntimeInfo();
    markBootstrapStageFinished('dbInit', {
      status: 'passed',
      message: runtime.backend === 'worker'
        ? 'Worker-backed local database is ready.'
        : runtime.fallbackReason
          ? `Local database is ready using the in-thread fallback. ${runtime.fallbackReason}`
          : 'In-thread local database is ready.',
      metadata: {
        backend: runtime.backend,
        persistent: runtime.persistent,
        ...(runtime.fallbackReason ? { fallbackReason: runtime.fallbackReason } : {}),
      },
    });
  } catch (error) {
    markBootstrapStageFinished('dbInit', {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Local database initialization failed.',
    });
    throw error;
  }

  // 2. Run Migrations
  markBootstrapStageStarted('migrations');
  try {
    await migrateLocalDatabase();
    markBootstrapStageFinished('migrations', {
      status: 'passed',
      message: 'Local schema migrations completed.',
    });
  } catch (error) {
    markBootstrapStageFinished('migrations', {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Local schema migrations failed.',
    });
    throw error;
  }

  // 2.5. Start the platform layer in the background.
  // Any failure here is non-fatal and must not block app boot.
  void initPlatformBootstrap().catch((error) => {
    console.warn('[Bootstrap] Platform bootstrap failed (non-fatal):', error);
  });

  // 2.6. Probe the local browser runtime conservatively after boot.
  // This stays non-fatal and never blocks app startup or the existing worker hot path.
  markBootstrapStageStarted('runtimeProbe');
  void import('./runtime/modelManager')
    .then(({ browserModelManager }) => browserModelManager.initCapabilityProbe())
    .then(() => {
      markBootstrapStageFinished('runtimeProbe', {
        status: 'passed',
        message: 'Runtime capability probe completed.',
      });
    })
    .catch((error) => {
      markBootstrapStageFinished('runtimeProbe', {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Runtime capability probe failed.',
      });
      console.warn('[Bootstrap] Runtime capability probe failed (non-fatal):', error);
    });

  const scheduleRuntimeSmoke = () => {
    markBootstrapStageStarted('runtimeSmoke');
    void import('./runtime/modelManager')
      .then(({ browserModelManager }) => browserModelManager.runRuntimeSmokeCheck())
      .then((report) => {
        markBootstrapStageFinished('runtimeSmoke', {
          status: report.overallState === 'passed' ? 'passed' : 'failed',
          message: report.overallState === 'passed'
            ? 'Runtime smoke checks passed.'
            : report.db.state === 'failed'
              ? report.db.message
              : report.browserMl.message,
        });
      })
      .catch((error) => {
        markBootstrapStageFinished('runtimeSmoke', {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Runtime smoke check failed.',
        });
        console.warn('[Bootstrap] Runtime smoke check failed (non-fatal):', error);
      });
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(scheduleRuntimeSmoke, { timeout: 12_000 });
  } else {
    setTimeout(scheduleRuntimeSmoke, 8_000);
  }

  // 3. Warmup Inference (optional, deferred to keep startup fast)
  // inferenceClient.init();

  // 4. Build HNSW vector indexes after an idle period.
  // Index construction loads the full embedding column into the WASM heap, which
  // can spike memory by 100-300 MB. Deferring past first paint avoids OOM kills
  // on iOS Safari and other low-memory environments.
  if (shouldSkipVectorIndexBuild()) {
    markBootstrapStageFinished('indexBuild', {
      status: 'skipped',
      message: 'Skipped HNSW index build on mobile, standalone, or low-memory device.',
    });
    console.log('[Bootstrap] Skipping HNSW index build on mobile/standalone or low-memory devices.');
    console.log('[Bootstrap] Semantic search will still work, but vector ranking may be slower.');
    console.log('[Bootstrap] Done.');
    return;
  }

  const scheduleIndexBuild = () => {
    markBootstrapStageStarted('indexBuild');
    paperDB.buildIndexes().then(() => {
      markBootstrapStageFinished('indexBuild', {
        status: 'passed',
        message: 'Deferred HNSW indexes are ready.',
      });
    }).catch((err) => {
      markBootstrapStageFinished('indexBuild', {
        status: 'failed',
        message: err instanceof Error ? err.message : 'HNSW index build failed.',
      });
      console.warn('[Bootstrap] HNSW index build failed (non-fatal):', err);
    });
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(scheduleIndexBuild, { timeout: 10_000 });
  } else {
    setTimeout(scheduleIndexBuild, 5_000);
  }

  console.log('[Bootstrap] Done.');
}
