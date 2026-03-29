# ATProto OAuth Compliance Research (March 2026)

This document maps the current authentication implementation in this repo against
ATProto OAuth requirements and proposes an integration plan to become protocol
compliant.

Implementation status note:

- The repo now includes an OAuth browser-client implementation in `src/atproto/oauthClient.ts`, `src/atproto/AtpContext.tsx`, and `src/components/LoginScreen.tsx`.
- The compliance matrix below captures the pre-migration baseline used for planning.

## Sources (authoritative)

- ATProto OAuth spec: https://atproto.com/specs/oauth
- Bluesky OAuth implementation guide: https://docs.bsky.app/docs/advanced-guides/oauth-client
- ATProto OAuth patterns: https://atproto.com/guides/oauth-patterns
- ATProto auth guidance: https://atproto.com/guides/auth and https://atproto.com/guides/sdk-auth

## Current State In This Repository

Observed implementation is app-password based password-session login:

- Login form asks for handle/email + app password.
- Login uses `agent.login({ identifier, password })`.
- Session stores `accessJwt` and `refreshJwt` in browser `localStorage`.
- Session restore uses `agent.resumeSession(...)`.
- No OAuth redirect/callback route handling (`state`, `iss`, `code`).
- No PAR (Pushed Authorization Request).
- No DPoP proof generation or nonce handling.
- No client metadata document (`client_id` URL-hosted metadata JSON).

Relevant files:

- `src/components/LoginScreen.tsx`
- `src/atproto/AtpContext.tsx`
- `src/store/sessionStore.ts`
- `ARCHITECTURE.md` (OAuth listed as planned)

## Compliance Matrix

### Required by ATProto OAuth profile

1. Authorization code flow with PKCE (S256)
2. PAR required for auth request initialization
3. DPoP required for PAR, token requests, and resource requests
4. Client metadata document hosted at a public `client_id` URL
5. Scope must include `atproto` (and app-specific scopes as needed)
6. Callback validation with `state` and `iss`
7. Token response validation:
   - `sub` present and DID identity checks are consistent
   - `scope` present and includes `atproto`
8. Resource + authorization server discovery and metadata validation
9. Refresh token lifecycle handling (single-use rotation behavior)

### Status in this app

- 1. Missing
- 2. Missing
- 3. Missing
- 4. Missing
- 5. Missing in OAuth context (not applicable to password flow)
- 6. Missing
- 7. Missing
- 8. Missing
- 9. Partial (password-session refresh behavior via SDK, not OAuth-compliant flow)

## Key Gaps and Risks

1. Not protocol-compliant for end-user app auth
- The app currently authenticates with app passwords and direct session tokens.
- Current ATProto guidance says end-user login flows should implement OAuth.

2. Missing sender-constrained tokens (DPoP)
- Tokens are not bound to per-session key material.
- ATProto OAuth mandates DPoP + nonce handling.

3. Missing decentralized trust/discovery checks
- No DID/resource/auth server discovery and consistency checks (`iss`, `sub`, expected DID).

4. Browser session storage risk profile
- Storing long-lived auth tokens in localStorage increases exposure to XSS exfiltration.
- This is not automatically disallowed by the profile, but is a security concern.

## Recommended Implementation Path

For this app (React SPA), start with a public browser OAuth client.

Recommended package family (TypeScript):

- `@atproto/oauth-client-browser` (SPA/public client)
- `@atproto/oauth-client` (core, transitive)

Notes:

- OAuth package versions should be pinned and reviewed at implementation time.
- If you need longer-lived and stronger security sessions, move to a BFF
  confidential client later (`@atproto/oauth-client-node` on server side).

## Proposed Architecture (Phase 1: Public Browser Client)

1. Add OAuth client bootstrap module
- New module (example): `src/atproto/oauthClient.ts`
- Initialize browser OAuth client with:
  - `client_id` pointing to hosted metadata JSON
  - declared redirect URI
  - requested scopes including `atproto`

2. Publish client metadata JSON
- Host at production URL like:
  - `https://<your-domain>/oauth/client-metadata.json`
- Include required fields:
  - `client_id`
  - `application_type: "web"`
  - `grant_types: ["authorization_code", "refresh_token"]`
  - `response_types: ["code"]`
  - `redirect_uris`
  - `scope` (must include `atproto`)
  - `dpop_bound_access_tokens: true`
  - `token_endpoint_auth_method: "none"` (public client)

3. Replace password login UI path
- Login button triggers OAuth start (redirect to auth flow), not password submit.
- Keep optional "developer fallback" app-password mode only if explicitly needed.

4. Add OAuth callback handling route
- New route/module (example): `src/oauth/callback.tsx`
- Validate callback params and finalize token exchange via SDK.
- Persist SDK session state (including DPoP/session artifacts) using SDK guidance.

5. Integrate with existing session store
- Replace `accessJwt`/`refreshJwt` manual shape with OAuth session state.
- Keep Zustand store as app-facing auth state, but source credentials from OAuth SDK.

6. Update ATProto call layer
- Ensure outbound authenticated calls use OAuth-managed session + DPoP proofs.
- Preserve existing retry/error normalization in `src/lib/atproto/client.ts`.

7. Identity and issuer checks
- Enforce post-login DID consistency (`sub`) and issuer/resource consistency (`iss`).
- Fail closed on mismatch and clear session.

## Phase 2 (Optional): BFF Confidential Client

Use if you want stronger security and longer session lifetime:

- Implement server-side OAuth with `@atproto/oauth-client-node`
- Keep client assertions (`private_key_jwt`) and key material server-side
- Frontend uses secure app session (cookie/session) rather than token storage
- Backend proxies PDS requests (BFF pattern)

## Minimal Scope Strategy

Start with least privilege, then add only what is needed:

- Always include `atproto`
- Add specific permissions/scopes required by current feature set
- Avoid broad transition scopes unless migration convenience is necessary

## Migration Plan for This Codebase

1. Add config + metadata
- `.env.example`:
  - `VITE_ATPROTO_OAUTH_CLIENT_ID`
  - `VITE_ATPROTO_OAUTH_REDIRECT_URI`
  - `VITE_ATPROTO_OAUTH_SCOPE`

2. Add OAuth modules
- `src/atproto/oauthClient.ts`
- `src/oauth/OAuthCallback.tsx`

3. Refactor auth context/store
- `src/atproto/AtpContext.tsx`
- `src/store/sessionStore.ts`
- remove direct `agent.login` password path from default flow

4. Update login UI
- `src/components/LoginScreen.tsx` to offer "Continue with Bluesky" OAuth button

5. Add route wiring
- callback route in app shell/router

6. Regression test matrix
- Login success with handle
- Callback replay/state mismatch rejection
- Issuer mismatch rejection
- Token refresh and app reload restore
- DPoP nonce retry handling
- Logout/revoke behavior

## Acceptance Criteria

The app is considered ATProto OAuth-compliant for end-user login when:

1. No password-based login is required for normal user auth flow.
2. OAuth flow uses PAR + PKCE + DPoP.
3. Public client metadata is hosted and valid.
4. Callback and token validation includes `state`, `iss`, `sub`, and `scope` checks.
5. Authenticated requests are sender-constrained via DPoP.
6. Session refresh and restore are reliable under token rotation.

## Practical Notes

- Keep app-password auth only for local diagnostics or non-user automation paths.
- If keeping fallback auth in UI, label clearly as legacy/developer-only and disable by default in production.
- Consider CSP hardening before/alongside OAuth rollout, especially if browser storage remains in use.
