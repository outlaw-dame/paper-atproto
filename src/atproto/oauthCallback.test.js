import { describe, expect, it } from 'vitest';
import { buildClearedOAuthCallbackUrl, getOAuthCallbackError, hasOAuthCallbackParams, } from './oauthCallback.js';
describe('oauthCallback helpers', () => {
    it('detects OAuth callback query parameters', () => {
        expect(hasOAuthCallbackParams('?code=abc&state=xyz')).toBe(true);
        expect(hasOAuthCallbackParams('?foo=bar')).toBe(false);
    });
    it('maps provider cancel errors to a safe user-facing message', () => {
        expect(getOAuthCallbackError('?error=access_denied&error_description=User%20cancelled')).toEqual({
            code: 'access_denied',
            description: 'User cancelled',
            message: 'Sign-in was cancelled.',
        });
    });
    it('sanitizes callback descriptions and avoids reflecting raw provider details', () => {
        expect(getOAuthCallbackError('?error=invalid_request&error_description=%20bad%00state%20')).toEqual({
            code: 'invalid_request',
            description: 'badstate',
            message: 'The sign-in response was invalid. Please try again.',
        });
    });
    it('removes OAuth callback params while preserving unrelated params and hashes', () => {
        expect(buildClearedOAuthCallbackUrl('http://127.0.0.1:5180/?code=abc&state=xyz&tab=home#auth')).toBe('/?tab=home#auth');
        expect(buildClearedOAuthCallbackUrl('http://127.0.0.1:5180/?tab=home')).toBeNull();
    });
});
//# sourceMappingURL=oauthCallback.test.js.map