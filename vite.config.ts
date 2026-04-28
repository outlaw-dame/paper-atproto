import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { precompressPlugin } from './scripts/vite/precompressPlugin';

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRequestOrigin(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const rawHostHeader = req.headers.host;
  const host = Array.isArray(rawHostHeader) ? rawHostHeader[0] : rawHostHeader;
  if (!host) return null;

  const rawProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(rawProtoHeader) ? rawProtoHeader[0] : rawProtoHeader;
  const protocol = forwardedProto?.split(',')[0]?.trim() || 'http';
  return `${protocol}://${host}`;
}

function sanitizeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOAuthScope(rawValue: string | undefined): string {
  const raw = rawValue?.trim();
  const defaults = [
    'atproto',
    'transition:generic',
    'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview',
    'rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app#bsky_appview',
  ];
  if (!raw) return defaults.join(' ');

  const deduped = Array.from(
    new Set(
      raw
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => /^[\x21-\x7E]+$/.test(token)),
    ),
  );

  if (!deduped.length) return defaults.join(' ');
  if (!deduped.includes('atproto')) {
    deduped.unshift('atproto');
  }
  return deduped.join(' ');
}

function buildRedirectUris(origin: string, oauthRedirectUrisOverride?: string[]): string[] {
  if (oauthRedirectUrisOverride?.length) {
    const sanitized = oauthRedirectUrisOverride
      .map(sanitizeHttpUrl)
      .filter((value): value is string => Boolean(value));
    if (sanitized.length) {
      return Array.from(new Set(sanitized));
    }
  }

  return [new URL('/', origin).toString()];
}

function createOAuthClientMetadataResponse(
  req: { headers: Record<string, string | string[] | undefined> },
  options: {
    oauthMetadataOrigin?: string;
    oauthClientName: string;
    oauthScope: string;
    oauthClientTos?: string;
    oauthClientPrivacy?: string;
    oauthRedirectUrisOverride?: string[];
  },
) {
  const requestOrigin = getRequestOrigin(req);
  const effectiveOrigin = sanitizeHttpUrl(options.oauthMetadataOrigin || '') || requestOrigin;

  if (!effectiveOrigin) {
    return {
      status: 500,
      body: {
        error: 'OAuth metadata origin could not be determined.',
      },
    };
  }

  const metadataUrl = new URL('/oauth/client-metadata.json', effectiveOrigin).toString();
  const responseBody: Record<string, unknown> = {
    $schema: 'https://atproto.com/specs/oauth-client-metadata#',
    client_id: metadataUrl,
    client_name: options.oauthClientName,
    client_uri: effectiveOrigin,
    redirect_uris: buildRedirectUris(effectiveOrigin, options.oauthRedirectUrisOverride),
    scope: options.oauthScope,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };

  const tosUri = options.oauthClientTos && sanitizeHttpUrl(options.oauthClientTos);
  const privacyUri = options.oauthClientPrivacy && sanitizeHttpUrl(options.oauthClientPrivacy);
  if (tosUri) responseBody.tos_uri = tosUri;
  if (privacyUri) responseBody.policy_uri = privacyUri;

  return {
    status: 200,
    body: responseBody,
  };
}

export default defineConfig(({ command, mode }) => {
  // Limit config-loaded env vars to the intended client-facing prefix.
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // 'cloudflare' deploys to Cloudflare Pages (base '/'), all other values
  // keep the GitHub Pages subpath ('/paper-atproto/').
  const deployTarget = env.VITE_DEPLOY_TARGET === 'cloudflare' ? 'cloudflare' : 'github-pages';
  const prodBase = deployTarget === 'cloudflare' ? '/' : '/paper-atproto/';

  const devPort = parseOptionalPort(env.VITE_DEV_PORT) ?? 5180;
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? env.VITE_GLYMPSE_API_BASE_URL ?? 'http://localhost:3011';
  const devHost = env.VITE_DEV_HOST ?? '0.0.0.0';
  const hmrHost = env.VITE_HMR_HOST;
  const hmrProtocol = env.VITE_HMR_PROTOCOL === 'wss' ? 'wss' : 'ws';
  const hmrClientPort = parseOptionalPort(env.VITE_HMR_CLIENT_PORT);
  const hmrPort = parseOptionalPort(env.VITE_HMR_PORT);
  const enableIsolationHeaders = env.VITE_ENABLE_ISOLATION_HEADERS !== '0';
  const oauthClientName = env.VITE_ATPROTO_OAUTH_CLIENT_NAME?.trim() || 'Glimpse';
  const oauthClientTos = env.VITE_ATPROTO_OAUTH_TOS_URI?.trim();
  const oauthClientPrivacy = env.VITE_ATPROTO_OAUTH_PRIVACY_URI?.trim();
  const oauthScope = normalizeOAuthScope(env.VITE_ATPROTO_OAUTH_SCOPE);
  const oauthMetadataOrigin = env.VITE_ATPROTO_OAUTH_METADATA_ORIGIN?.trim();
  const oauthRedirectUrisOverride = env.VITE_ATPROTO_OAUTH_REDIRECT_URIS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    // Keep the GitHub Pages base in production builds, but do not force local
    // development under a subpath. Cloudflare Pages deploys at root ('/').
    base: command === 'serve' ? '/' : prodBase,
    plugins: [
      react(),
      precompressPlugin({
        minSizeBytes: 1024,
        gzipLevel: 6,
        zstdLevel: 8,
        maxFileBytes: 4_000_000,
      }),
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

            const response = createOAuthClientMetadataResponse(
              req as { headers: Record<string, string | string[] | undefined> },
              {
                oauthClientName,
                oauthScope,
                ...(oauthMetadataOrigin ? { oauthMetadataOrigin } : {}),
                ...(oauthClientTos ? { oauthClientTos } : {}),
                ...(oauthClientPrivacy ? { oauthClientPrivacy } : {}),
                ...(oauthRedirectUrisOverride?.length ? { oauthRedirectUrisOverride } : {}),
              },
            );
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
      } : {},
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
          // Avoid eagerly preloading large vendor bundles that are not on
          // the critical rendering path. They load on demand when their
          // importing chunk executes (or when the service-worker prefetches them).
          const DEFERRED_CHUNKS = [
            'vendor-atproto',
            'vendor-pglite',
            'vendor-ml',
            // jsonld + feedsmith are only needed for RSS/feed parsing features.
            'vendor-jsonld',
            // konsta UI library — progressive enhancement, not critical-path.
            'vendor-konsta',
          ];
          return deps.filter(
            (dep) => !DEFERRED_CHUNKS.some((name) => dep.includes(name)),
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
            // Split @atproto OAuth client (needed for login) from the heavier
            // @atproto/api package (only needed after authentication).
            if (
              id.includes('node_modules/@atproto/oauth-client') ||
              id.includes('node_modules/@atproto-labs/')
            ) {
              return 'vendor-atproto-oauth';
            }
            if (id.includes('node_modules/@atproto')) {
              return 'vendor-atproto-api';
            }
            if (id.includes('node_modules/@electric-sql/pglite')) {
              return 'vendor-pglite';
            }
            if (id.includes('node_modules/onnxruntime-web') || id.includes('node_modules/@xenova/transformers')) {
              return 'vendor-ml';
            }
            // jsonld + feedsmith are only needed for feed-parsing and linked-data
            // features. Extracting them prevents them from being inlined into the
            // main shared chunk, which would inflate the critical-path bundle.
            if (id.includes('node_modules/jsonld') || id.includes('node_modules/rdf-')) {
              return 'vendor-jsonld';
            }
            if (id.includes('node_modules/feedsmith')) {
              return 'vendor-jsonld';
            }
            // konsta UI library — extract so the lazy StoryMode/ComposeSheet
            // shared chunk doesn't carry its full weight.
            if (id.includes('node_modules/konsta')) {
              return 'vendor-konsta';
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
  };
});
