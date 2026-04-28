import { PGlite } from '@electric-sql/pglite';
import { worker } from '@electric-sql/pglite/worker';
import { paperDbExtensions } from '../db/extensions';

await worker({
  init: async (options) => {
    const {
      dataDir,
      id: _id,
      meta: _meta,
      ...runtimeOptions
    } = options;

    return await PGlite.create(dataDir, {
      ...runtimeOptions,
      extensions: paperDbExtensions,
    });
  },
});
