import { paperDB } from './db.js';
import { migratePostsTable } from './db/migrations.js';
import { initPlatformBootstrap } from './pwa/bootstrap.js';
// import { inferenceClient } from './workers/InferenceClient.js';

function shouldSkipVectorIndexBuild(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;

  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const matchMedia = window.matchMedia?.bind(window);
  const isStandalone =
    (!!matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) ||
    (isIOS && 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0);
  const isLowMemoryDevice = Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4;

  return isIOS || isAndroid || isStandalone || isLowMemoryDevice;
}

/**
 * Initializes the application infrastructure.
 * Call this from main.tsx before rendering the app.
 */
export async function initApp() {
  console.log('[Bootstrap] Initializing...');

  // 1. Initialize DB and Extensions
  await paperDB.init();

  // 2. Run Migrations
  await migratePostsTable();

  // 2.5. Start the platform layer in the background.
  // Any failure here is non-fatal and must not block app boot.
  void initPlatformBootstrap().catch((error) => {
    console.warn('[Bootstrap] Platform bootstrap failed (non-fatal):', error);
  });

  // 3. Warmup Inference (optional, deferred to keep startup fast)
  // inferenceClient.init();

  // 4. Build HNSW vector indexes after an idle period.
  // Index construction loads the full embedding column into the WASM heap, which
  // can spike memory by 100-300 MB. Deferring past first paint avoids OOM kills
  // on iOS Safari and other low-memory environments.
  if (shouldSkipVectorIndexBuild()) {
    console.log('[Bootstrap] Skipping HNSW index build on mobile/standalone or low-memory devices.');
    console.log('[Bootstrap] Semantic search will still work, but vector ranking may be slower.');
    console.log('[Bootstrap] Done.');
    return;
  }

  const scheduleIndexBuild = () => {
    paperDB.buildIndexes().catch((err) => {
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
