import { paperDB } from './db';
import { migratePostsTable } from './db/migrations';
// import { inferenceClient } from './workers/InferenceClient';

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

  console.log('[Bootstrap] Done.');
}