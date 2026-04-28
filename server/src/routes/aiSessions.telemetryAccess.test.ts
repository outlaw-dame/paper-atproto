import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = {
  NODE_ENV: 'production',
  AI_SESSION_TELEMETRY_ADMIN_SECRET: 'super-secret',
  CORS_ALLOW_PRIVATE_NETWORK_IN_DEV: true,
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
};

const getAiSessionTelemetryMock = vi.fn(() => ({ routeErrors: 0 }));
const resetAiSessionTelemetryMock = vi.fn();

vi.mock('../config/env.js', () => ({
  env: envMock,
}));

vi.mock('../ai/sessions/telemetry.js', () => ({
  getAiSessionTelemetry: getAiSessionTelemetryMock,
  recordProductionRedactedError: vi.fn(),
  recordRouteError: vi.fn(),
  resetAiSessionTelemetry: resetAiSessionTelemetryMock,
}));

vi.mock('../ai/sessions/schemas.js', () => ({
  PresenceWriteRequestSchema: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
  ResolveThreadSummarySessionRequestSchema: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
  SendMessageRequestSchema: { safeParse: vi.fn(() => ({ success: true, data: {} })) },
}));

vi.mock('../ai/sessions/store.js', () => ({
  assertSessionAccess: vi.fn(async () => undefined),
  bootstrapSession: vi.fn(async () => ({})),
  readEventLane: vi.fn(async () => ({ items: [], nextOffset: 0 })),
  readPresenceLane: vi.fn(async () => ({ items: [], nextOffset: 0 })),
  readStateLane: vi.fn(async () => ({ items: [], nextOffset: 0 })),
  resolveThreadSummarySession: vi.fn(async () => ({ id: 'as_1234567890ab' })),
  writePresence: vi.fn(async () => ({})),
  writeSessionMessage: vi.fn(async () => ({ deduplicated: false })),
}));

vi.mock('../ai/sessions/durableProxy.js', () => ({
  proxyDurableRead: vi.fn(async () => null),
}));

describe('aiSessions telemetry access control', () => {
  beforeEach(() => {
    getAiSessionTelemetryMock.mockClear();
    resetAiSessionTelemetryMock.mockClear();
  });

  it('blocks telemetry reads in production without admin secret', async () => {
    const { aiSessionsRouter } = await import('./aiSessions.js');
    const response = await aiSessionsRouter.request('/telemetry', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Glympse-User-Did': 'did:plc:abcdefghijklmnop',
      },
    });

    expect(response.status).toBe(403);
    expect(getAiSessionTelemetryMock).not.toHaveBeenCalled();
  });

  it('allows telemetry reads in production with correct admin secret', async () => {
    const { aiSessionsRouter } = await import('./aiSessions.js');
    const response = await aiSessionsRouter.request('/telemetry', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
        'X-Glympse-User-Did': 'did:plc:abcdefghijklmnop',
        'X-AI-Telemetry-Admin-Secret': 'super-secret',
      },
    });

    expect(response.status).toBe(200);
    expect(getAiSessionTelemetryMock).toHaveBeenCalledTimes(1);
  });
});
