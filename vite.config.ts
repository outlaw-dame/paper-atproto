import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devPort = Number(process.env.VITE_DEV_PORT ?? 5180);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? process.env.VITE_GLYMPSE_API_BASE_URL ?? 'http://localhost:3011';
const devHost = process.env.VITE_DEV_HOST ?? '0.0.0.0';
const hmrHost = process.env.VITE_HMR_HOST;
const hmrProtocol = process.env.VITE_HMR_PROTOCOL === 'wss' ? 'wss' : 'ws';
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined;
const hmrPort = process.env.VITE_HMR_PORT
  ? Number(process.env.VITE_HMR_PORT)
  : undefined;
const enableIsolationHeaders = process.env.VITE_ENABLE_ISOLATION_HEADERS === '1';

export default defineConfig(({ command }) => ({
  // Keep the GitHub Pages base in production builds, but do not force local
  // development under a subpath.
  base: command === 'serve' ? '/' : '/paper-atproto/',
  plugins: [react()],
  server: {
    port: devPort,
    strictPort: false,
    host: devHost,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/health': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
    ...(hmrHost || typeof hmrClientPort === 'number' || typeof hmrPort === 'number'
      ? {
          hmr: {
            ...(hmrHost ? { host: hmrHost } : {}),
            protocol: hmrProtocol,
            ...(typeof hmrClientPort === 'number' ? { clientPort: hmrClientPort } : {}),
            ...(typeof hmrPort === 'number' ? { port: hmrPort } : {}),
          },
        }
      : {}),
    headers: enableIsolationHeaders ? {
      // Enable SharedArrayBuffer (needed for onnxruntime-web's threaded WASM backend).
      // Without these, ort@1.14.0 fails to register backends during module init with
      // "Cannot read properties of undefined (reading 'registerBackend')".
      // 'credentialless' COEP (not 'require-corp') lets cross-origin images/GIFs
      // load without requiring CORP headers on every CDN.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    } : undefined,
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', '@xenova/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  build: {
    modulePreload: {
      resolveDependencies: (_url, deps) => {
        // Avoid eagerly preloading very large vendor bundles.
        // They will still load on demand when their importing chunks execute.
        return deps.filter(
          (dep) =>
            !dep.includes('vendor-atproto') &&
            !dep.includes('vendor-pglite') &&
            !dep.includes('vendor-ml'),
        );
      },
    },
    rollupOptions: {
      // Treat heavy Node.js-only deps as external so they don't crash the browser bundle
      external: [],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'vendor-motion';
          }
          if (id.includes('node_modules/@atproto')) {
            return 'vendor-atproto';
          }
          if (id.includes('node_modules/@electric-sql/pglite')) {
            return 'vendor-pglite';
          }
          if (id.includes('node_modules/onnxruntime-web') || id.includes('node_modules/@xenova/transformers')) {
            return 'vendor-ml';
          }
          return undefined;
        },
      },
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
}));
