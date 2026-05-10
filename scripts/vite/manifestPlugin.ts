// ─── Dynamic Manifest Plugin ─────────────────────────────────────────────────
// Rewrites base-sensitive fields in manifest.json at build time so the same
// source file works for both GitHub Pages (/paper-atproto/) and Cloudflare (/).
//
// Fields rewritten: id, start_url, scope, shortcuts[].url,
//                   share_target.action, protocol_handlers[].url
//
// In dev mode, Vite serves the public/ file as-is. The plugin adds a dev-server
// middleware that intercepts /manifest.json and returns the correct base.
//
// Never throws — any failure is logged and the original file is left intact.

import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ManifestShortcut = {
  name: string;
  short_name?: string;
  description?: string;
  url: string;
  icons?: unknown[];
};

type ManifestShareTarget = {
  action: string;
  method?: string;
  enctype?: string;
  params?: Record<string, string>;
};

type ManifestProtocolHandler = {
  protocol: string;
  url: string;
};

type WebManifest = {
  id?: string;
  start_url?: string;
  scope?: string;
  shortcuts?: ManifestShortcut[];
  share_target?: ManifestShareTarget;
  protocol_handlers?: ManifestProtocolHandler[];
  [key: string]: unknown;
};

const GITHUB_BASE = '/paper-atproto/';

function rewriteManifestBase(manifest: WebManifest, newBase: string): WebManifest {
  const rewrite = (url: string) => url.replace(GITHUB_BASE, newBase);

  const result: WebManifest = { ...manifest };

  if (typeof result.id === 'string') result.id = rewrite(result.id);
  if (typeof result.start_url === 'string') result.start_url = rewrite(result.start_url);
  if (typeof result.scope === 'string') result.scope = rewrite(result.scope);

  if (Array.isArray(result.shortcuts)) {
    result.shortcuts = result.shortcuts.map((s) => ({
      ...s,
      url: typeof s.url === 'string' ? rewrite(s.url) : s.url,
    }));
  }

  if (result.share_target && typeof result.share_target.action === 'string') {
    result.share_target = {
      ...result.share_target,
      action: rewrite(result.share_target.action),
    };
  }

  if (Array.isArray(result.protocol_handlers)) {
    result.protocol_handlers = result.protocol_handlers.map((h) => ({
      ...h,
      url: typeof h.url === 'string' ? rewrite(h.url) : h.url,
    }));
  }

  return result;
}

export function manifestPlugin(prodBase: string): Plugin {
  let outDir = 'dist';

  return {
    name: 'dynamic-manifest',

    configResolved(config) {
      outDir = config.build.outDir;
    },

    // Dev server: serve the manifest with the correct base for the current session.
    configureServer(server) {
      server.middlewares.use('/manifest.json', (req, res, next) => {
        if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
          next();
          return;
        }
        try {
          const raw = readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf-8');
          const manifest = JSON.parse(raw) as WebManifest;
          // Dev always serves at '/' base.
          const devManifest = rewriteManifestBase(manifest, '/');
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(devManifest, null, 2));
        } catch (err) {
          console.error('[manifestPlugin] Failed to serve manifest:', err);
          next();
        }
      });
    },

    // Build: rewrite the emitted manifest.json with the correct base after Vite
    // copies all public/ assets to the output directory.
    closeBundle() {
      if (prodBase === GITHUB_BASE) return; // nothing to rewrite

      const manifestPath = resolve(outDir, 'manifest.json');
      try {
        const raw = readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as WebManifest;
        const rewritten = rewriteManifestBase(manifest, prodBase);
        writeFileSync(manifestPath, JSON.stringify(rewritten, null, 2), 'utf-8');
        console.info(`[manifestPlugin] Rewrote manifest base to "${prodBase}"`);
      } catch (err) {
        console.error('[manifestPlugin] Failed to rewrite manifest in output:', err);
      }
    },
  };
}
