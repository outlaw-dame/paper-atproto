# Compression Deployment Guide

This guide provides production-safe edge/CDN patterns for serving precompressed `.gz` and `.zst` assets and preserving correct HTTP semantics.

## Security and correctness baseline

1. Always negotiate on `Accept-Encoding`.
2. Return `Vary: Accept-Encoding` for any negotiable response.
3. Return only one `Content-Encoding` value that matches the actual body bytes.
4. Preserve source media type in `Content-Type` when serving `.gz`/`.zst` variants.
5. Do not compress already-compressed media (`jpg`, `png`, `webp`, `mp4`, `zip`, `pdf`, etc).
6. Respect `Cache-Control: no-transform` from origin responses.
7. Disable on payloads below a threshold (for example 1 KiB) and cap very large payloads to avoid CPU abuse.
8. Keep strong validators consistent with representation. If you transform at edge, either:
   - emit variant-specific `ETag`, or
   - strip `ETag` and rely on cache key + freshness policy.

## Origin behavior in this repository

The API server already negotiates and compresses dynamic responses, and static build output emits `.gz` and `.zst` files.

- Runtime middleware: `server/src/lib/compression.ts`
- Build precompression plugin: `scripts/vite/precompressPlugin.ts`

## NGINX example (static assets)

Use NGINX static modules when available to serve precompressed files directly.

```nginx
http {
  gzip_static on;
  # Requires nginx build with ngx_http_gzip_static_module.

  # If zstd static module is available in your NGINX build:
  # zstd_static on;

  server {
    listen 443 ssl http2;
    server_name example.com;

    root /var/www/paper-atproto/dist;

    location / {
      try_files $uri $uri/ /index.html;
      add_header Vary "Accept-Encoding" always;
    }

    location ~* \.(js|css|html|json|svg|wasm|map)$ {
      expires 1y;
      add_header Cache-Control "public, max-age=31536000, immutable" always;
      add_header Vary "Accept-Encoding" always;
    }
  }
}
```

## Cloudflare Worker example (precompressed variants)

This pattern checks for `.zst` first, then `.gz`, then falls back.

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const acceptEncoding = request.headers.get('accept-encoding') || '';

    const canZstd = /(^|,|\s)zstd(\s*;q=[0-9.]+)?(,|$)/i.test(acceptEncoding);
    const canGzip = /(^|,|\s)gzip(\s*;q=[0-9.]+)?(,|$)/i.test(acceptEncoding);

    const candidates = [];
    if (canZstd) candidates.push({ suffix: '.zst', encoding: 'zstd' });
    if (canGzip) candidates.push({ suffix: '.gz', encoding: 'gzip' });
    candidates.push({ suffix: '', encoding: null });

    for (const candidate of candidates) {
      const assetUrl = new URL(url.pathname + candidate.suffix, url.origin);
      const assetReq = new Request(assetUrl.toString(), request);
      const response = await env.ASSETS.fetch(assetReq);
      if (!response.ok) continue;

      const headers = new Headers(response.headers);
      headers.set('Vary', mergeVary(headers.get('Vary'), 'Accept-Encoding'));
      if (candidate.encoding) headers.set('Content-Encoding', candidate.encoding);
      if (candidate.encoding) headers.delete('ETag');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

function mergeVary(existing, value) {
  if (!existing) return value;
  const tokens = existing.split(',').map((v) => v.trim()).filter(Boolean);
  if (!tokens.some((token) => token.toLowerCase() === value.toLowerCase())) tokens.push(value);
  return tokens.join(', ');
}
```

## Fastly VCL pattern (high level)

1. In `vcl_recv`, parse `Accept-Encoding` and normalize to allowed codings (`zstd`, `gzip`, or identity).
2. Include normalized encoding in cache key.
3. In `vcl_backend_response`, set `Vary: Accept-Encoding` and avoid double compression.
4. In `vcl_deliver`, ensure `Content-Encoding` matches selected variant.

## Operational checks

Run these checks before release:

1. `curl -I -H 'Accept-Encoding: gzip' https://your-host/path`
2. `curl -I -H 'Accept-Encoding: zstd, gzip' https://your-host/path`
3. `curl -I -H 'Accept-Encoding: identity' https://your-host/path`
4. Verify `Vary: Accept-Encoding` present for negotiable responses.
5. Verify `Content-Encoding` and body bytes match (`gunzip` / `zstd -d` succeeds).
6. Confirm no-transform endpoints are not modified.

## Privacy and security notes

1. Compression can interact with secret-bearing reflected responses (BREACH-style risk). Do not reflect attacker-controlled input in responses that also contain secrets.
2. Keep authenticated API responses non-cacheable unless explicitly designed for shared caches.
3. Avoid logging raw request payloads while benchmarking/observing compression behavior.
