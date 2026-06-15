import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/src/**/*.test.ts'],
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    deps: {
      // Allow vitest to resolve server-only dependencies (hono, ioredis, etc.)
      // that live in the server workspace's node_modules.
      moduleDirectories: ['node_modules', path.resolve(__dirname, 'server/node_modules')],
    },
  },
  resolve: {
    alias: {
      // Help Vite resolve bare-specifier imports from server workspace tests.
      // This ensures hono, openai, etc. resolve from the server's node_modules.
    },
  },
});
