import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

Object.assign(process.env, loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''));
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
const oauthClientName = process.env.VITE_ATPROTO_OAUTH_CLIENT_NAME?.trim() || 'Glimpse';
const oauthClientTos = process.env.VITE_ATPROTO_OAUTH_TOS_URI?.trim();
const oauthClientPrivacy = process.env.VITE_ATPROTO_OAUTH_PRIVACY_URI?.trim();
const oauthScope = normalizeOAuthScope(process.env.VITE_ATPROTO_OAUTH_SCOPE);
const oauthMetadataOrigin = process.env.VITE_ATPROTO_OAUTH_METADATA_ORIGIN?.trim();
const oauthRedirectUrisOverride = process.env.VITE_ATPROTO_OAUTH_REDIRECT_URIS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
function getRequestOrigin(req) {
    const rawHostHeader = req.headers.host;
    const host = Array.isArray(rawHostHeader) ? rawHostHeader[0] : rawHostHeader;
    if (!host)
        return null;
    const rawProtoHeader = req.headers['x-forwarded-proto'];
    const forwardedProto = Array.isArray(rawProtoHeader) ? rawProtoHeader[0] : rawProtoHeader;
    const protocol = forwardedProto?.split(',')[0]?.trim() || 'http';
    return `${protocol}://${host}`;
}
function sanitizeHttpUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            return null;
        return parsed.toString();
    }
    catch {
        return null;
    }
}
function normalizeOAuthScope(rawValue) {
    const raw = rawValue?.trim();
    const defaults = [
        'atproto',
        'transition:generic',
        'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview',
        'rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview',
    ];
    if (!raw)
        return defaults.join(' ');
    const deduped = Array.from(new Set(raw
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => /^[\x21-\x7E]+$/.test(token))));
    if (!deduped.length)
        return defaults.join(' ');
    if (!deduped.includes('atproto')) {
        deduped.unshift('atproto');
    }
    return deduped.join(' ');
}
function buildRedirectUris(origin) {
    if (oauthRedirectUrisOverride?.length) {
        const sanitized = oauthRedirectUrisOverride
            .map(sanitizeHttpUrl)
            .filter((value) => Boolean(value));
        if (sanitized.length) {
            return Array.from(new Set(sanitized));
        }
    }
    return [new URL('/', origin).toString()];
}
function createOAuthClientMetadataResponse(req) {
    const requestOrigin = getRequestOrigin(req);
    const effectiveOrigin = sanitizeHttpUrl(oauthMetadataOrigin || '') || requestOrigin;
    if (!effectiveOrigin) {
        return {
            status: 500,
            body: {
                error: 'OAuth metadata origin could not be determined.',
            },
        };
    }
    const metadataUrl = new URL('/oauth/client-metadata.json', effectiveOrigin).toString();
    const responseBody = {
        $schema: 'https://atproto.com/specs/oauth-client-metadata#',
        client_id: metadataUrl,
        client_name: oauthClientName,
        client_uri: effectiveOrigin,
        redirect_uris: buildRedirectUris(effectiveOrigin),
        scope: oauthScope,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        dpop_bound_access_tokens: true,
    };
    const tosUri = oauthClientTos && sanitizeHttpUrl(oauthClientTos);
    const privacyUri = oauthClientPrivacy && sanitizeHttpUrl(oauthClientPrivacy);
    if (tosUri)
        responseBody.tos_uri = tosUri;
    if (privacyUri)
        responseBody.policy_uri = privacyUri;
    return {
        status: 200,
        body: responseBody,
    };
}
export default defineConfig(({ command }) => ({
    // Keep the GitHub Pages base in production builds, but do not force local
    // development under a subpath.
    base: command === 'serve' ? '/' : '/paper-atproto/',
    plugins: [
        react(),
        {
            name: 'oauth-client-metadata-endpoint',
            configureServer(server) {
                server.middlewares.use('/oauth/client-metadata.json', (req, res) => {
                    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
                        res.statusCode = 405;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({ error: 'Method not allowed' }));
                        return;
                    }
                    const response = createOAuthClientMetadataResponse(req);
                    res.statusCode = response.status;
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(response.body));
                });
            },
        },
    ],
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
                return deps.filter((dep) => !dep.includes('vendor-atproto') &&
                    !dep.includes('vendor-pglite') &&
                    !dep.includes('vendor-ml'));
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
//# sourceMappingURL=vite.config.js.map
