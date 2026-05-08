# Security Audit Report - 2026-05-08

## Executive Summary

I audited the projects in this workspace with emphasis on authentication boundaries, external URL handling, server-side fetches, paid/provider-backed AI routes, browser/PWA behavior, dependency risk, and accidental secret exposure.

The most important result is that several server routes rely on caller-provided identity (`X-Glympse-User-Did`) plus an Origin/CORS check. That is not a server-side authentication mechanism. A direct HTTP client can set both headers and act as another DID. This combines badly with public AI, media, translation, and classifier endpoints, some of which can invoke paid providers or heavy local workers.

I did not find committed real secrets in the tracked files scanned. I did find dependency advisories in both the root app and the Hono server, including critical `protobufjs` advisories and high-risk parser/framework advisories.

## Scope

Reviewed projects and surfaces:

- Root React/Vite/TypeScript app, PWA/service worker, feed ingestion, ATProto OAuth client, local PGlite/Drizzle schema, browser ML code.
- Hono Node server in `server/`, including LLM, premium AI, AI sessions, media proxy/transcription, translation, rate limiting, origin policy, and URL sanitization.
- Cloudflare Pages functions in `functions/`, especially Workers AI endpoints and catch-all security headers.
- VS Code tab sharing extension in `tools/tab-share-agent-extension`.
- Package manifests and dependency audit output for root, server, and VS Code extension.

## Methodology

- Inventoried manifests, routes, environment examples, service worker behavior, Cloudflare functions, and extension entrypoints.
- Ran `npm audit --omit=dev` and full `npm audit` for root and server, and `npm audit` for the VS Code extension.
- Ran targeted tracked-file secret scans for common private key, API key, token, password, and OAuth/client-secret patterns.
- Reviewed high-risk code manually: auth/origin/DID handling, paid provider routes, server-side fetches, SSRF controls, safe browsing behavior, upload handling, rate limiting, feed parsing/rendering, and service worker caching.
- Performed targeted runtime validations with in-process Hono route calls and sanitizer calls.

## Findings

### F-01 Critical - Server-side identity and authorization are spoofable

Several routes derive the authenticated actor from `X-Glympse-User-Did`, a header supplied by the browser client, then only verify request Origin. Origin is useful as a CSRF and browser policy signal, but it is not authentication. Non-browser clients can set it freely.

Evidence:

- `server/src/routes/aiSessions.ts:62` parses the caller DID from `X-Glympse-User-Did`.
- `server/src/routes/aiSessions.ts:98` middleware combines that header with `assertTrustedBrowserOrigin`.
- `server/src/routes/aiSessions.ts:126` and following handlers use the caller DID for session bootstrap, state, presence, messages, and events.
- `src/aiSessions/sessionClient.ts:231` sends `X-Glympse-User-Did` from the client.
- `server/src/routes/premiumAi.ts:72` parses the same DID header for premium AI routes.
- `server/src/routes/premiumAi.ts:233` uses that DID for premium route entitlements.
- `server/src/entitlements/resolveAiEntitlements.ts:64` grants `pro` when the caller-supplied DID is present in `PREMIUM_AI_ALLOWLIST_DIDS`.
- `server/src/lib/originPolicy.ts:103` trusts same-host Origin, and `server/src/lib/originPolicy.ts:144` only enforces browser Origin in production.

Dynamic validation:

- A direct in-process request to `/thread-summary/resolve` with `Origin: https://api.example` and `X-Glympse-User-Did: did:plc:attacker` returned `200` and created an AI session for an arbitrary root URI.
- The same route correctly rejected a mismatched Origin with `403`, which confirms the Origin check exists but does not make the DID cryptographic.
- With `PREMIUM_AI_ALLOWLIST_DIDS=did:plc:allowlisted`, `resolvePremiumAiEntitlements("did:plc:allowlisted")` returned `tier:"pro"` and premium capabilities solely from the supplied DID string.

Impact:

- An attacker can create AI sessions as arbitrary DIDs.
- If a private session ID leaks, the attacker can access/write as the victim DID. Shared or root-derived sessions are especially exposed because the attacker can present any DID.
- An attacker can access premium routes by spoofing an allowlisted DID if they know or guess one. Deployments with broad default premium tiers would be worse.
- This is a hard auth boundary failure when the server is internet-exposed.

Recommended remediation:

- Require real server-side authentication before `/api/ai/sessions/*`, `/api/premium-ai/*`, and premium `/api/llm/*` routes.
- Derive DID server-side from a verified ATProto OAuth/DPoP session, signed server session cookie, or bearer token. Do not authorize from a client-provided DID header.
- Treat Origin as CSRF defense only.
- Remove same-host Origin trust from any authorization decision. Use explicit allowed origins only for browser CORS/CSRF behavior.
- If a display DID header remains useful, keep it non-authoritative and compare it against the verified session identity.

### F-02 Critical - Provider-backed and expensive AI/model endpoints are public

Multiple public routes can call paid providers, Workers AI, local models, or heavy CPU/GPU workers without authentication or entitlement checks.

Evidence:

- `server/src/routes/llm.ts:249` registers middleware that only assigns request IDs and logs. It does not authenticate.
- `server/src/routes/llm.ts:322` exposes `/write/interpolator`.
- `server/src/routes/llm.ts:421` exposes `/analyze/media`.
- `server/src/routes/llm.ts:511` exposes `/analyze/media/premium`; it can use `env.GEMINI_API_KEY` and `runGeminiMediaAnalyzer`.
- `server/src/routes/llm.ts:608` exposes `/write/search-story`.
- `server/src/routes/llm.ts:735` exposes `/write/composer-guidance`.
- `server/src/config/env.ts:61` defaults Gemini/OpenAI interpolator enhancer flags to enabled unless explicitly set false.
- `src/intelligence/modelClient.ts:1425` calls `/api/llm/analyze/media/premium` without auth headers.
- `functions/api/llm/analyze/composer-classifier.ts:91` accepts public POSTs and invokes Workers AI.
- `functions/api/edge/media-classify.ts:231` accepts public POSTs and invokes Workers AI for user-supplied media URLs.
- `server/src/routes/composerClassifier.ts:87` exposes a public classifier route in the Hono server.

Impact:

- Provider cost abuse against Gemini, OpenAI, Workers AI, local Ollama, transcription, and translation infrastructure.
- Public generation/classification proxy usable by arbitrary internet clients.
- Increased DoS risk because model routes often do more work per request than ordinary API endpoints.

Recommended remediation:

- Require verified auth and entitlements for every route that invokes a paid provider or heavy model worker.
- Move `/api/llm/analyze/media/premium` behind the same entitlement gate as `/api/premium-ai/*`.
- Rate limit by verified user plus IP, with daily quotas for expensive actions.
- Add provider-level budgets, concurrency limits, and fail-closed behavior when quota/auth backends are unavailable.
- Protect Cloudflare Workers AI functions with a service token or call them only from the authenticated backend.

### F-03 Critical - SSRF and bandwidth proxy risk in remote media handling

The server has URL validation for obvious local/private literals, but it does not resolve DNS or pin resolved IPs. Internal DNS names and DNS-rebinding domains can pass validation. The media proxy can also stream arbitrary fetched content back to the caller.

Evidence:

- `server/src/lib/sanitize.ts:40` validates syntax/protocol and calls local-host checks.
- `server/src/lib/sanitize.ts:78` blocks literal local/private IPs and some local hostnames, but does not resolve DNS.
- Dynamic validation showed `sanitizeRemoteProcessingUrl("http://metadata.google.internal/computeMetadata/v1/")` was accepted, while literal `169.254.169.254` and `127.0.0.1` URLs were rejected.
- `server/src/routes/media.ts:311` exposes `/proxy` and fetches a sanitized remote URL.
- `server/src/routes/media.ts:143` follows redirects with `fetchWithRedirects`.
- `server/src/routes/media.ts:31` sends a broad Accept header including `*/*`.
- `server/src/routes/media.ts:349` streams the response body to the caller.
- `server/src/routes/media.ts:242` downloads remote media for transcription.
- `server/src/services/qwenMultimodal.ts:385` fetches remote media for multimodal analysis.
- `server/src/services/geminiMultimodal.ts:118` fetches remote media for Gemini analysis.
- `server/src/services/safeBrowsing.ts:236` treats missing SafeBrowsing API key as `safe:true`.
- `server/src/services/safeBrowsing.ts:311` treats SafeBrowsing request failures as `safe:true`.
- `server/src/config/env.ts:111` defaults SafeBrowsing fail-closed behavior to false.

Impact:

- An attacker can potentially make the server fetch internal DNS names, cloud metadata aliases, or DNS-rebinding targets.
- `/api/media/proxy` can become an unauthenticated server-side bandwidth proxy and may exfiltrate internal HTTP responses if reachable.
- Analyzer routes can push internal/private responses into model processing.

Recommended remediation:

- Resolve DNS before every outbound fetch and after every redirect; reject private, loopback, link-local, multicast, reserved, and metadata ranges for all A/AAAA answers.
- Prevent DNS rebinding by pinning the resolved IP for the connection or routing through an egress proxy/firewall that blocks private ranges.
- Prefer allowlisting expected media hosts such as known Bluesky/CDN hosts over accepting arbitrary URLs.
- Auth-protect or disable `/api/media/proxy`, add strict content-type allowlists, and enforce response byte caps on streamed proxy responses.
- Set server-side URL processing to fail closed when SafeBrowsing status is unknown, but do not rely on SafeBrowsing as an SSRF control.

### F-04 High - Public heavy media, transcription, translation, and SSE routes enable DoS

Several unauthenticated routes perform high-cost work or hold long-lived connections. Existing rate limiting reduces some risk but does not fully address per-user abuse, memory pressure, or distributed deployments.

Evidence:

- `server/src/app.ts:41` configures route-level rate limits, but `/api/media/*` is still public at 30 requests/minute and `/api/translate/*` at 120 requests/minute.
- `server/src/routes/media.ts:366` exposes transcription routes.
- `server/src/routes/media.ts:230` reads multipart upload files into memory with `file.arrayBuffer()`.
- `server/src/config/env.ts:145` defaults transcription uploads to 150 MB and worker timeout to 180 seconds.
- `server/src/services/media/transcriptionWorkerBridge.ts:83` spawns the Python transcription worker without a shell, which is good, but the work remains expensive.
- `server/src/routes/translate.ts:19` allows 10,000 characters inline and batch requests up to 30 items.
- `server/src/routes/conversationWatch.ts:53` skips Origin checks when the Origin header is absent.
- `server/src/routes/conversationWatch.ts:82` exposes SSE watch behavior that can hold connections and poll upstream services.
- `server/src/lib/rate-limit.ts:309` trusts a configured IP header only when `RATE_LIMIT_TRUST_PROXY=true`.
- `server/src/lib/rate-limit.ts:409` falls back to a global key when no trusted client IP is available, allowing one client to exhaust global quota for everyone.
- `server/src/config/env.ts:97` defaults Redis rate-limit fail-closed to false.

Impact:

- CPU/GPU exhaustion through transcription, translation, and model endpoints.
- Memory pressure from large multipart uploads buffered before processing.
- Long-lived SSE connection exhaustion.
- Global-rate-limit self-DoS if client IP extraction is not configured correctly.
- Distributed deployments may degrade to inconsistent memory-based limits if Redis is unavailable and fail-closed is false.

Recommended remediation:

- Require auth or service-token protection for transcription, translation, media analysis, and SSE watch routes.
- Enforce body size limits before buffering multipart uploads.
- Add per-user daily quotas, concurrency limits, queue depth limits, and request cancellation.
- Configure ingress to set and strip client IP headers correctly, then rate limit by verified user plus IP.
- Use Redis over TLS/passwords where available and set rate limiting to fail closed for production.
- Reduce unauthenticated SSE connection duration and enforce connection caps.

### F-05 High - Dependency advisories affect active surfaces

Both the root app and server have dependency advisories. Some are in active user-facing paths, especially XML feed parsing and Hono server request handling.

Root `npm audit --omit=dev`:

- 13 vulnerabilities: 9 high, 4 critical.
- Critical: `protobufjs <7.5.5`, via `onnx-proto` -> `onnxruntime-web` -> `@xenova/transformers`.
- High: `drizzle-orm <0.45.2`, current root dependency is `drizzle-orm ^0.45.1`.
- High: `fast-xml-builder <=1.1.6`.
- High: `fast-xml-parser <=5.6.0`, via `feedsmith`.
- High: `lodash-es <=4.17.23`, via `chevrotain`/`traqula`.

Root full `npm audit` adds dev advisories:

- 19 vulnerabilities total: 5 moderate, 10 high, 4 critical.
- High: `vite 8.0.0 - 8.0.4`, current root dependency is `vite ^8.0.1`.
- Moderate: `esbuild <=0.24.2`, via `drizzle-kit`.
- Moderate: `postcss <8.5.10`, current root dependency is `postcss ^8.5.8`.

Server `npm audit`:

- 4 vulnerabilities: 3 moderate, 1 critical.
- Critical: `protobufjs <7.5.5`.
- Moderate: `@hono/node-server <1.19.13`.
- Moderate: `hono <=4.12.15`.
- Moderate: `brace-expansion 2.0.0 - 2.0.2`.

Evidence of reachability:

- `src/feeds.ts:361` fetches user-provided feed content and parses it with `parseFeed`, making the XML parser advisory relevant to malicious feed subscriptions.
- `server/package.json:18` and `server/package.json:20` use vulnerable Hono ranges.
- Hono body-limit and static-serving advisories matter because the server accepts large uploads and public JSON bodies.
- Drizzle exploitability depends on dynamic identifier construction. Reviewed SQL-heavy service code largely uses parameterized `pg.query`, but the package should still be patched promptly.

Recommended remediation:

- Upgrade `drizzle-orm` to `>=0.45.2`.
- Upgrade `feedsmith`/`fast-xml-parser` to patched versions, or replace feed parsing with a maintained parser version that includes the fixes.
- Upgrade Hono and `@hono/node-server` to patched versions.
- Upgrade Vite to a patched 8.x release and `postcss` to `>=8.5.10`.
- Address `protobufjs >=7.5.5` through a safe package upgrade or override. Do not blindly run `npm audit fix --force` for the root app because npm proposes a breaking downgrade of `@xenova/transformers`.
- Add CI audit gates for root and server production dependencies, plus a separate warning gate for dev dependencies.

### F-06 Medium/High - Feed item URLs are not consistently sanitized before DOM sinks

Feed subscription URLs are normalized, but item-level links, enclosures, transcripts, chapters, and images from parsed feeds are stored and rendered without consistently applying the existing external URL sanitizer.

Evidence:

- `src/lib/feedUrls.ts:3` normalizes feed subscription URLs.
- `src/feeds.ts:417` stores feed item `link`, enclosure URL, transcript URL, chapters URL, and chapter image URLs from parsed feed content.
- `src/components/FeedList.tsx:183` renders `href={item.link}`.
- `src/components/FeedList.tsx:604` renders media `src={url}`.
- `src/components/FeedList.tsx:823` renders transcript `href={transcriptUrl}`.
- `src/components/FeedList.tsx:885` renders chapter image `src={chapter.img}`.
- `src/tabs/ExploreTab.tsx:2488` renders feed item links.
- `src/tabs/ExploreTab.tsx:2651` renders recent feed item card links.
- A safer helper already exists at `src/lib/safety/externalUrl.ts:46`, and `openExternalUrl` at `src/lib/safety/externalUrl.ts:96` performs SafeBrowsing-aware click handling.

Impact:

- Malicious feeds can create unsafe outbound click targets such as `javascript:` or `data:` URLs.
- Untrusted media/image URLs can trigger browser-side requests to attacker-controlled or local/private addresses, leaking network context or user agent information.
- React escapes text content, so this is not an HTML injection finding. The risk is URL scheme handling and automatic loading of untrusted remote resources.

Recommended remediation:

- Sanitize every feed item URL, enclosure URL, transcript URL, chapter URL, and image URL at ingestion.
- Re-check URLs at render time and render inert text when unsafe.
- Use `openExternalUrl()` for outbound clicks rather than raw anchors where feasible.
- Avoid auto-loading untrusted remote media/images unless they pass protocol and host checks.
- Add regression tests for `javascript:alert(1)`, `data:`, `http://localhost`, private IPs, internal hostnames, and valid HTTPS URLs.

### F-07 Medium - Server-side SafeBrowsing behavior fails open

SafeBrowsing integration is present, but server-side processing treats missing API keys and request failures as safe by default.

Evidence:

- `server/src/services/safeBrowsing.ts:236` returns `safe:true` when the API key is not configured.
- `server/src/services/safeBrowsing.ts:311` returns `safe:true` on request failure.
- `server/src/config/env.ts:111` defaults `AI_SAFE_BROWSING_FAIL_CLOSED` to false.
- Client click handling in `src/lib/safety/externalUrl.ts:96` is stricter, which is positive, but server fetch paths are the bigger risk.

Impact:

- In production without a SafeBrowsing key, or during API failures, server-side media and model fetches continue for unknown URLs.
- This weakens phishing/malware protection and compounds SSRF/media-fetch risk.

Recommended remediation:

- Set server-side URL processing to fail closed in production.
- Separate "user clicked an unknown browser URL" behavior from "server will fetch this URL" behavior; the latter should be much stricter.
- Keep SSRF-safe DNS/IP egress controls even when SafeBrowsing is enabled.

### F-08 Low/Informational - VS Code tab-share extension can copy sensitive file contents to chat

The extension is an intentional local utility, but it can copy full file contents or selections into the clipboard/chat prompt, including sensitive files if the user invokes it there.

Evidence:

- `tools/tab-share-agent-extension/src/extension.ts:21` builds a prompt containing file path and file content.
- `tools/tab-share-agent-extension/src/extension.ts:99` builds the prompt for clipboard/chat.
- `tools/tab-share-agent-extension/src/extension.ts:100` writes it to the clipboard.
- `tools/tab-share-agent-extension/src/extension.ts:102` can auto-open chat.
- `tools/tab-share-agent-extension/package.json:62` defaults `paperAtprotoTabShare.autoOpenChat` to true.

Impact:

- Accidental disclosure of local secrets or private source snippets to a chat provider if invoked on sensitive files.
- The extension does not appear to upload data by itself; the risk is user-mediated disclosure through clipboard/chat.

Recommended remediation:

- Add confirmation prompts for `.env`, key files, SSH keys, certificate files, and files matching likely secret patterns.
- Consider defaulting `autoOpenChat` to false or adding first-run consent.
- Redact obvious token patterns before placing content in the clipboard.

## Positive Controls Observed

- `.env`, `.env.local`, `server/.env`, and `server/.env.local` are ignored by git. Tracked environment files are examples, not secrets.
- Targeted tracked-file secret scan found only synthetic test secrets in test files.
- Cloudflare Pages catch-all and `public/_headers` define strong CSP, HSTS, referrer, permissions, and no-store behavior for OAuth/service worker surfaces.
- Service worker avoids caching auth/session/token URLs and restricts cached image origins.
- Service worker push notification navigation is normalized to same-origin/base-path URLs.
- ATProto OAuth client contains HTTPS/loopback guardrails for production client metadata.
- Many model route inputs use Zod schemas with bounded text lengths and enum validation.
- Transcription worker process launch uses `spawn` without shell interpolation.
- AI session metadata sanitizer removes prototype-pollution keys such as `__proto__`, `constructor`, and `prototype`.

## Prioritized Remediation Plan

### Immediate, 24-48 hours

1. Put verified authentication in front of AI sessions, premium AI, paid provider routes, Cloudflare Workers AI functions, media transcription, and translation/model endpoints.
2. Stop authorizing from `X-Glympse-User-Did`; derive DID from a verified server session/token.
3. Disable or protect `/api/media/proxy` until DNS/IP SSRF protections are in place.
4. Add provider quota/concurrency controls and temporary IP-level emergency limits for AI/model routes.
5. Patch Hono, `@hono/node-server`, Vite, PostCSS, Drizzle, and feed XML parser dependencies where safe.

### Short term, 1-2 weeks

1. Implement DNS-resolution SSRF defenses and redirect revalidation for all server-side fetches.
2. Add strict host allowlists for known trusted media/CDN domains where possible.
3. Add per-user quotas for transcription, translation, media analysis, and premium model features.
4. Enforce multipart/body size before buffering file uploads.
5. Sanitize feed item URLs at ingestion and rendering, with regression tests.
6. Set production server-side SafeBrowsing and rate limiting to fail closed.

### Medium term

1. Add security CI gates: dependency audits, secret scanning, and route/auth regression tests.
2. Add integration tests proving unauthenticated clients cannot reach provider-backed endpoints.
3. Add SSRF test cases for metadata hostnames, DNS rebinding-style names, redirects to private IPs, IPv6 private ranges, and unusual numeric IP encodings.
4. Add operational monitoring for provider spend, route-level latency, rejected SSRF attempts, and rate-limit denials.
5. Document deployment requirements for trusted proxy headers, Redis rate limit backend, required auth middleware, and safe browsing configuration.

## Validation Notes

- Secret scan: no committed real secrets found by targeted regex scan. Synthetic secret strings exist in tests and are expected.
- Git tracking check: `.env`, `.env.local`, `server/.env`, and `server/.env.local` are ignored and not tracked.
- Dependency audits: root and server have actionable vulnerabilities; VS Code extension audit reported zero vulnerabilities.
- Dynamic auth proof: unauthenticated direct request with spoofed same-host Origin and spoofed DID successfully created an AI session.
- Dynamic origin proof: mismatched Origin was rejected, confirming the issue is not missing Origin checks but relying on Origin as if it authenticates the DID.
- Dynamic SSRF proof: metadata-style internal DNS hostname passed sanitizer; literal private/local IPs were rejected.

## Limitations

This was a source-level and targeted local dynamic audit, not a full deployed penetration test. I did not attack a live deployment, brute force session IDs, test real cloud metadata access, or run a full entropy-based secret scanner across binary/model assets. The findings above are still actionable because they are grounded in code paths and targeted runtime proofs.
