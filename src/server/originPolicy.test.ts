import { describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  CORS_ALLOWED_ORIGINS: 'https://app.glympse.example, https://staging.glympse.example',
  CORS_ALLOW_PRIVATE_NETWORK_IN_DEV: true,
  NODE_ENV: 'production' as 'production' | 'development',
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

import { isTrustedOriginForRequest } from '../../server/src/lib/originPolicy.js';

describe('origin policy', () => {
  it('allows explicit frontend origins for cross-origin API deployments', () => {
    expect(isTrustedOriginForRequest(
      'https://app.glympse.example',
      'https://api.glympse.example/api/ai/sessions/test',
    )).toBe(true);
  });

  it('allows same-host origins without extra configuration', () => {
    expect(isTrustedOriginForRequest(
      'https://api.glympse.example',
      'https://api.glympse.example/api/llm/write/interpolator',
    )).toBe(true);
  });

  it('rejects untrusted production origins', () => {
    expect(isTrustedOriginForRequest(
      'https://evil.example',
      'https://api.glympse.example/api/premium-ai/entitlements',
    )).toBe(false);
  });

  it('allows private-network dev origins when enabled', () => {
    envMock.NODE_ENV = 'development';
    expect(isTrustedOriginForRequest(
      'http://192.168.1.20:5173',
      'http://127.0.0.1:3011/api/ai/sessions/test',
    )).toBe(true);
  });
});
