import { paperDB } from './db.js';
import { migratePostsTable } from './db/migrations.js';
// import { inferenceClient } from './workers/InferenceClient.js';

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

  // 3. Warmup Inference (optional, deferred to keep startup fast)
  // inferenceClient.init();

  // 4. Build HNSW vector indexes after an idle period.
  // Index construction loads the full embedding column into the WASM heap, which
  // can spike memory by 100-300 MB. Deferring past first paint avoids OOM kills
  // on iOS Safari and other low-memory environments.
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