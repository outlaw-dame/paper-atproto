import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/paper-atproto/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', '@xenova/transformers'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      // Treat heavy Node.js-only deps as external so they don't crash the browser bundle
      external: [],
    },
  },
  resolve: {
    alias: {
      // Shim Node.js built-ins that leak into browser bundles
      'node:fs': '/src/shims/empty.ts',
      'node:path': '/src/shims/empty.ts',
      'node:os': '/src/shims/empty.ts',
      'node:crypto': '/src/shims/empty.ts',
      'node:stream': '/src/shims/empty.ts',
      'node:buffer': '/src/shims/empty.ts',
      'node:util': '/src/shims/empty.ts',
      'node:url': '/src/shims/empty.ts',
      'node:http': '/src/shims/empty.ts',
      'node:https': '/src/shims/empty.ts',
      'node:net': '/src/shims/empty.ts',
      'node:tls': '/src/shims/empty.ts',
      'node:zlib': '/src/shims/empty.ts',
      'node:events': '/src/shims/empty.ts',
      'node:assert': '/src/shims/empty.ts',
      'node:worker_threads': '/src/shims/empty.ts',
    },
  },
});
