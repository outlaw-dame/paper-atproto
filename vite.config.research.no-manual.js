import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Research config variant: disables manual chunking to compare default Vite chunking behavior.
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
        modulePreload: {
            resolveDependencies: (_url, deps) => {
                return deps.filter((dep) => !dep.includes('vendor-atproto') &&
                    !dep.includes('vendor-pglite') &&
                    !dep.includes('vendor-ml'));
            },
        },
        rollupOptions: {
            external: [],
            output: {},
        },
    },
    resolve: {
        alias: {
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
//# sourceMappingURL=vite.config.research.no-manual.js.map