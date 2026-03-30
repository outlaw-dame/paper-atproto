import { describe, expect, it } from 'vitest';
import {
  createOAuthState,
  getOAuthRuntimeConfigStatus,
  hasFollowingFeedScope,
  FOLLOWING_TIMELINE_SCOPE,
  isRecoverableOAuthClientError,
  isLoopbackOAuthOrigin,
  isLikelyAuthIdentifier,
  sanitizeAuthIdentifier,
} from './oauthClient.js';

describe('oauthClient auth identifier handling', () => {
  it('sanitizes control and zero-width characters from identifiers', () => {
    expect(sanitizeAuthIdentifier(' \u200Byou.bsky.social\u0000 ')).toBe('you.bsky.social');
  });

  it('accepts valid handles, dids, and https provider urls', () => {
    expect(isLikelyAuthIdentifier('you.bsky.social')).toBe(true);
    expect(isLikelyAuthIdentifier('did:plc:abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(isLikelyAuthIdentifier('https://bsky.social')).toBe(true);
  });

  it('rejects obviously unsafe or malformed identifiers', () => {
    expect(isLikelyAuthIdentifier('javascript:alert(1)')).toBe(false);
    expect(isLikelyAuthIdentifier('not a handle')).toBe(false);
    expect(isLikelyAuthIdentifier('')).toBe(false);
  });

  it('creates secure-looking non-empty state tokens', () => {
    const state = createOAuthState();
    expect(state).toMatch(/^[a-f0-9-]{16,}$/i);
  });

  it('blocks loopback-only oauth mode on non-local origins', () => {
    expect(getOAuthRuntimeConfigStatus('https://glimpse.example.com/', null)).toEqual({
      canStartOAuth: false,
      blockingMessage: 'Hosted OAuth client metadata is required outside local development. Set VITE_ATPROTO_OAUTH_CLIENT_ID to your public client metadata URL.',
      warningMessage: null,
    });
  });

  it('identifies loopback origins correctly for auth fallback decisions', () => {
    expect(isLoopbackOAuthOrigin('http://127.0.0.1:5180/')).toBe(true);
    expect(isLoopbackOAuthOrigin('http://localhost:5180/')).toBe(true);
    expect(isLoopbackOAuthOrigin('https://glimpse.example.com/')).toBe(false);
  });

  it('treats transition and granular AppView timeline scopes as sufficient for Following', () => {
    expect(hasFollowingFeedScope('atproto transition:generic')).toBe(true);
    expect(hasFollowingFeedScope(`atproto ${FOLLOWING_TIMELINE_SCOPE}`)).toBe(true);
    expect(hasFollowingFeedScope('atproto')).toBe(false);
  });

  it('recognizes closed browser oauth databases as recoverable client failures', () => {
    const error = new Error('Database closed');
    error.stack = 'Error: Database closed\n    at BrowserOAuthDatabase.cleanup (browser-oauth-database.js:1:1)';

    expect(isRecoverableOAuthClientError(error)).toBe(true);
  });

  it('does not swallow unrelated database errors', () => {
    const error = new Error('Database closed');
    error.stack = 'Error: Database closed\n    at unrelated-library.js:1:1';

    expect(isRecoverableOAuthClientError(error)).toBe(false);
  });

  it('blocks non-https non-loopback origins', () => {
    expect(getOAuthRuntimeConfigStatus('http://glimpse.example.com/', 'https://glimpse.example.com/oauth/client-metadata.json')).toEqual({
      canStartOAuth: false,
      blockingMessage: 'Browser OAuth requires HTTPS. Use localhost for development or deploy this app over HTTPS.',
      warningMessage: null,
    });
  });

  it('warns when hosted metadata origin differs from the deployed app origin', () => {
    expect(getOAuthRuntimeConfigStatus('https://app.example.com/', 'https://auth.example.com/oauth/client-metadata.json')).toEqual({
      canStartOAuth: true,
      blockingMessage: null,
      warningMessage: 'Hosted OAuth metadata is on a different origin from this app. Verify client_id and redirect_uris exactly match the deployed domain.',
    });
  });
});
