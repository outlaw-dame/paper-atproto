import { describe, expect, it } from 'vitest';
import {
  createOAuthState,
  getOAuthRuntimeConfigStatus,
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
