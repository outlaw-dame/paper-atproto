import { paperDB } from './db';
import { hybridSearch } from './search';
import { paperAuth } from './auth';
import { PaperSync } from './sync';

/**
 * Main application entry point.
 * Orchestrates database initialization, authentication, and synchronization.
 */
async function main() {
  console.log('Initializing Paper ATProto Application...');

  try {
    // 1. Initialize local database and search engine
    await paperDB.init();
    await hybridSearch.init();
    console.log('Local database and search engine initialized.');

    // 2. Handle Authentication (Example flow)
    // In a real app, this would be triggered by user interaction in the UI
    const identifier = process.env.ATPROTO_IDENTIFIER;
    const password = process.env.ATPROTO_PASSWORD;

    if (identifier && password) {
      console.log(`Attempting to login as ${identifier}...`);
      const session = await paperAuth.login(identifier, password);
      console.log('Authentication successful.');

      // 3. Initialize Synchronization Service
      const syncService = new PaperSync(paperAuth.getAgent());

      // 4. Perform Initial Sync
      console.log('Starting initial data synchronization...');
      await syncService.syncPosts(session.did);
      console.log('Initial synchronization complete.');

      // 5. Example: Create a new post
      // await syncService.createPost('Hello from my local-first ATProto app!');
      
      // 6. Example: Perform a hybrid search
      // const results = await hybridSearch.search('local-first');
      // console.log('Search results:', results.rows);
    } else {
      console.warn('ATPROTO_IDENTIFIER and ATPROTO_PASSWORD not found in environment. Skipping auto-login.');
      console.info('Please provide credentials to enable full synchronization features.');
    }

    console.log('Application ready.');
  } catch (error) {
    console.error('Application initialization failed:', error);
    // In a real app, you'd show a user-friendly error message in the UI
  }
}

main();
