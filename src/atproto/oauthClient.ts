import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { withRetry } from '../lib/atproto/retry.js';

const DEFAULT_HANDLE_RESOLVER = 'https://bsky.social';
const DEFAULT_OAUTH_SCOPE = 'atproto transition:generic';
const MAX_AUTH_IDENTIFIER_LENGTH = 512;

const OAUTH_CLIENT_ID = parseConfiguredUrl(
  import.meta.env.VITE_ATPROTO_OAUTH_CLIENT_ID,
  'VITE_ATPROTO_OAUTH_CLIENT_ID',
);
const OAUTH_HANDLE_RESOLVER =
  parseConfiguredUrl(import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER, 'VITE_ATPROTO_HANDLE_RESOLVER')
  ?? DEFAULT_HANDLE_RESOLVER;
const OAUTH_REQUESTED_SCOPE = parseConfiguredScope(import.meta.env.VITE_ATPROTO_OAUTH_SCOPE);

let oauthClientPromise: Promise<BrowserOAuthClient> | null = null;

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

function getDerivedClientIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.protocol !== 'https:') return null;
    return new URL('/oauth/client-metadata.json', currentUrl.origin).toString();
  } catch {
    return null;
  }
}

function resolveOAuthClientId(): string | null {
  return OAUTH_CLIENT_ID ?? getDerivedClientIdFromLocation();
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
    .filter((token) => /^[a-z][a-z0-9:._-]*$/i.test(token));

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
    clientMetadata: undefined,
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
  if (typeof window === 'undefined' && !currentHref) {
    return {
      canStartOAuth: Boolean(configuredClientId),
      blockingMessage: null,
      warningMessage: null,
    };
  }

  let currentUrl: URL;
  try {
    currentUrl = new URL(currentHref ?? window.location.href);
  } catch {
    return {
      canStartOAuth: false,
      blockingMessage: 'This app origin is invalid for OAuth. Reload the app from a valid HTTPS or localhost URL.',
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
      warningMessage: null,
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

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (!oauthClientPromise) {
    oauthClientPromise = buildOAuthClient().catch((error) => {
      oauthClientPromise = null;
      throw error;
    });
  }

  return oauthClientPromise;
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
  return OAUTH_REQUESTED_SCOPE;
}
