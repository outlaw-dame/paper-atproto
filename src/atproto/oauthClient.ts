import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { withRetry } from '../lib/atproto/retry';

const DEFAULT_HANDLE_RESOLVER = 'https://bsky.social';
const APPVIEW_AUDIENCE = 'did:web:api.bsky.app#bsky_appview';
export const FOLLOWING_TIMELINE_SCOPE = `rpc:app.bsky.feed.getTimeline?aud=${APPVIEW_AUDIENCE}`;
const APPVIEW_PROFILE_SCOPE = `rpc:app.bsky.actor.getProfile?aud=${APPVIEW_AUDIENCE}`;
const DEFAULT_OAUTH_SCOPE = [
  'atproto',
  'transition:generic',
  FOLLOWING_TIMELINE_SCOPE,
  APPVIEW_PROFILE_SCOPE,
].join(' ');
const MAX_AUTH_IDENTIFIER_LENGTH = 512;

const OAUTH_CLIENT_ID = parseConfiguredUrl(
  import.meta.env.VITE_ATPROTO_OAUTH_CLIENT_ID,
  'VITE_ATPROTO_OAUTH_CLIENT_ID',
);
const OAUTH_HANDLE_RESOLVER =
  parseConfiguredUrl(import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER, 'VITE_ATPROTO_HANDLE_RESOLVER')
  ?? DEFAULT_HANDLE_RESOLVER;
const OAUTH_REQUESTED_SCOPE = parseConfiguredScope(import.meta.env.VITE_ATPROTO_OAUTH_SCOPE);
const LOCALHOST_OAUTH_SCOPE = 'atproto';
const OAUTH_CLIENT_STORAGE_RECOVERY_STACK_FRAGMENTS = [
  'oauth-client-browser',
  'browser-oauth-database',
  'indexed-db/db',
];
const OAUTH_RECOVERY_LISTENER_KEY = '__paperOAuthRecoveryListenerInstalled__';

let oauthClientPromise: Promise<BrowserOAuthClient> | null = null;
let oauthClientInstance: BrowserOAuthClient | null = null;
let oauthClientResetPromise: Promise<void> | null = null;
let hasInstalledOAuthClientRecovery = false;

export interface OAuthRuntimeConfigStatus {
  canStartOAuth: boolean;
  blockingMessage: string | null;
  warningMessage: string | null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isLoopbackUrl(url: URL): boolean {
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

function parseCurrentUrl(currentHref?: string): URL | null {
  if (typeof window === 'undefined' && !currentHref) return null;

  try {
    return new URL(currentHref ?? window.location.href);
  } catch {
    return null;
  }
}

function resolveOAuthClientId(): string | null {
  return OAUTH_CLIENT_ID;
}

function isClosedOAuthDatabaseMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes('database closed') || normalized.includes('database has been disposed');
}

export function isRecoverableOAuthClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!isClosedOAuthDatabaseMessage(error.message)) return false;
  if (!error.stack) return true;

  const stack = error.stack.toLowerCase();
  return OAUTH_CLIENT_STORAGE_RECOVERY_STACK_FRAGMENTS.some((fragment) => stack.includes(fragment));
}

async function disposeOAuthClient(client: BrowserOAuthClient | null): Promise<void> {
  if (!client) return;

  const asyncDisposable = client as BrowserOAuthClient & {
    [Symbol.asyncDispose]?: () => Promise<void>;
    dispose?: () => void;
  };

  try {
    if (typeof asyncDisposable[Symbol.asyncDispose] === 'function') {
      await asyncDisposable[Symbol.asyncDispose]!();
      return;
    }

    if (typeof asyncDisposable.dispose === 'function') {
      asyncDisposable.dispose();
    }
  } catch {
    // Disposal is best-effort only; never leak the original auth failure.
  }
}

function installOAuthClientRecovery(): void {
  if (hasInstalledOAuthClientRecovery || typeof window === 'undefined') return;

  const globalScope = globalThis as Record<string, unknown>;
  if (globalScope[OAUTH_RECOVERY_LISTENER_KEY] === true) {
    hasInstalledOAuthClientRecovery = true;
    return;
  }

  window.addEventListener('unhandledrejection', (event) => {
    if (!isRecoverableOAuthClientError(event.reason)) {
      return;
    }

    event.preventDefault();
    console.warn('[OAuth] Browser auth storage closed unexpectedly; resetting the client.');
    void resetOAuthClient('browser-storage-closed');
  });

  globalScope[OAUTH_RECOVERY_LISTENER_KEY] = true;
  hasInstalledOAuthClientRecovery = true;
}

function parseConfiguredUrl(rawValue: string | undefined, label: string): string | null {
  const value = rawValue?.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const isSecure = parsed.protocol === 'https:';
    const isLocalHttp = parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
    if (!isSecure && !isLocalHttp) {
      console.warn(`[OAuth] Ignoring ${label}: expected https URL or local loopback http URL.`);
      return null;
    }
    return parsed.toString();
  } catch {
    console.warn(`[OAuth] Ignoring ${label}: invalid URL.`);
    return null;
  }
}

function parseConfiguredScope(rawValue: string | undefined): string {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_OAUTH_SCOPE;

  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => /^[\x21-\x7E]+$/.test(token));

  if (!tokens.length) return DEFAULT_OAUTH_SCOPE;

  const deduped = Array.from(new Set(tokens));
  if (!deduped.includes('atproto')) {
    deduped.unshift('atproto');
  }

  return deduped.join(' ');
}

async function buildOAuthClient(): Promise<BrowserOAuthClient> {
  const resolvedClientId = resolveOAuthClientId();
  if (resolvedClientId) {
    return withRetry(
      () => BrowserOAuthClient.load({
        clientId: resolvedClientId,
        handleResolver: OAUTH_HANDLE_RESOLVER,
        responseMode: 'query',
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 400,
        capDelayMs: 1_500,
      },
    );
  }

  return new BrowserOAuthClient({
    // Loopback mode for local development when a public client_id is not configured.
    handleResolver: OAUTH_HANDLE_RESOLVER,
    responseMode: 'query',
  });
}

export function isHostedOAuthClientConfigured(): boolean {
  return Boolean(resolveOAuthClientId());
}

export function getOAuthRuntimeConfigStatus(
  currentHref?: string,
  configuredClientId: string | null = resolveOAuthClientId(),
): OAuthRuntimeConfigStatus {
  const currentUrl = parseCurrentUrl(currentHref);
  if (!currentUrl) {
    return {
      canStartOAuth: Boolean(configuredClientId),
      blockingMessage: null,
      warningMessage: null,
    };
  }

  const isSecureOrigin = currentUrl.protocol === 'https:';
  const isLoopbackOrigin = isLoopbackUrl(currentUrl);

  if (!isSecureOrigin && !isLoopbackOrigin) {
    return {
      canStartOAuth: false,
      blockingMessage: 'Browser OAuth requires HTTPS. Use localhost for development or deploy this app over HTTPS.',
      warningMessage: null,
    };
  }

  if (!configuredClientId && !isLoopbackOrigin) {
    return {
      canStartOAuth: false,
      blockingMessage: 'Hosted OAuth client metadata is required outside local development. Set VITE_ATPROTO_OAUTH_CLIENT_ID to your public client metadata URL.',
      warningMessage: null,
    };
  }

  if (!configuredClientId) {
    return {
      canStartOAuth: true,
      blockingMessage: null,
      warningMessage: 'Running in loopback OAuth mode without hosted client metadata. Following feed permission may be unavailable unless VITE_ATPROTO_OAUTH_CLIENT_ID is configured.',
    };
  }

  try {
    const clientUrl = new URL(configuredClientId);
    const warningMessage = isSecureOrigin && clientUrl.origin !== currentUrl.origin
      ? 'Hosted OAuth metadata is on a different origin from this app. Verify client_id and redirect_uris exactly match the deployed domain.'
      : null;

    return {
      canStartOAuth: true,
      blockingMessage: null,
      warningMessage,
    };
  } catch {
    return {
      canStartOAuth: false,
      blockingMessage: 'The configured OAuth client metadata URL is invalid. Fix VITE_ATPROTO_OAUTH_CLIENT_ID before signing in.',
      warningMessage: null,
    };
  }
}

export async function resetOAuthClient(_reason = 'manual'): Promise<void> {
  if (oauthClientResetPromise) {
    return oauthClientResetPromise;
  }

  const pendingClientPromise = oauthClientPromise;
  const existingClient = oauthClientInstance;

  oauthClientPromise = null;
  oauthClientInstance = null;

  oauthClientResetPromise = (async () => {
    const resolvedClient = existingClient ?? (pendingClientPromise ? await pendingClientPromise.catch(() => null) : null);
    await disposeOAuthClient(resolvedClient);
  })().finally(() => {
    oauthClientResetPromise = null;
  });

  return oauthClientResetPromise;
}

export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  installOAuthClientRecovery();

  if (oauthClientResetPromise) {
    await oauthClientResetPromise;
  }

  if (!oauthClientPromise) {
    oauthClientPromise = buildOAuthClient()
      .then((client) => {
        oauthClientInstance = client;
        return client;
      })
      .catch((error) => {
        oauthClientPromise = null;
        oauthClientInstance = null;
        throw error;
      });
  }

  return oauthClientPromise;
}

export async function withRecoveredOAuthClient<T>(
  operation: (oauthClient: BrowserOAuthClient) => Promise<T>,
  context = 'oauth-operation',
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const oauthClient = await getOAuthClient();
      return await operation(oauthClient);
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !isRecoverableOAuthClientError(error)) {
        throw error;
      }

      console.warn(`[OAuth] Recovering browser auth client after ${context} storage closure.`);
      await resetOAuthClient(context);
    }
  }

  throw lastError ?? new Error('OAuth client recovery exhausted.');
}

export function isLoopbackOAuthOrigin(currentHref?: string): boolean {
  const currentUrl = parseCurrentUrl(currentHref);
  return currentUrl ? isLoopbackUrl(currentUrl) : false;
}

function normalizeScopeSet(scope?: string): Set<string> {
  if (!scope) return new Set();
  return new Set(
    scope
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

export function hasFollowingFeedScope(scope?: string): boolean {
  const granted = normalizeScopeSet(scope);
  if (!granted.size) return false;

  return granted.has('transition:generic') || granted.has(FOLLOWING_TIMELINE_SCOPE);
}

export function sanitizeAuthIdentifier(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .slice(0, MAX_AUTH_IDENTIFIER_LENGTH);
}

export function isLikelyAuthIdentifier(value: string): boolean {
  if (!value) return false;
  if (value.length > MAX_AUTH_IDENTIFIER_LENGTH) return false;

  if (value.startsWith('did:')) {
    return /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/i.test(value);
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
    } catch {
      return false;
    }
  }

  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(value) && value.includes('.');
}

export function createOAuthState(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  throw new Error('Secure random generation is unavailable in this browser context.');
}

export function getOAuthRequestedScope(): string {
  if (isLoopbackOAuthOrigin() && !resolveOAuthClientId()) {
    return LOCALHOST_OAUTH_SCOPE;
  }
  return OAUTH_REQUESTED_SCOPE;
}
