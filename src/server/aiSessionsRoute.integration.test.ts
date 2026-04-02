import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../server/src/lib/errors.js';
import { getAiSessionTelemetry, resetAiSessionTelemetry } from '../../server/src/ai/sessions/telemetry.js';

const {
  mockAssertSessionAccess,
  mockBootstrapSession,
  mockReadEventLane,
  mockReadPresenceLane,
  mockReadStateLane,
  mockResolveThreadSummarySession,
  mockProxyDurableRead,
  mockWritePresence,
  mockWriteSessionMessage,
  envMock,
} = vi.hoisted(() => ({
  mockAssertSessionAccess: vi.fn(),
  mockBootstrapSession: vi.fn(),
  mockReadEventLane: vi.fn(),
  mockReadPresenceLane: vi.fn(),
  mockReadStateLane: vi.fn(),
  mockResolveThreadSummarySession: vi.fn(),
  mockProxyDurableRead: vi.fn(),
  mockWritePresence: vi.fn(),
  mockWriteSessionMessage: vi.fn(),
  envMock: {
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://app.glympse.example',
    CORS_ALLOW_PRIVATE_NETWORK_IN_DEV: true,
  },
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/ai/sessions/store.js', () => ({
  assertSessionAccess: mockAssertSessionAccess,
  bootstrapSession: mockBootstrapSession,
  readEventLane: mockReadEventLane,
  readPresenceLane: mockReadPresenceLane,
  readStateLane: mockReadStateLane,
  resolveThreadSummarySession: mockResolveThreadSummarySession,
  writePresence: mockWritePresence,
  writeSessionMessage: mockWriteSessionMessage,
}));

vi.mock('../../server/src/ai/sessions/durableProxy.js', () => ({
  proxyDurableRead: mockProxyDurableRead,
}));

import { aiSessionsRouter } from '../../server/src/routes/aiSessions.js';

const DID_HEADER = {
  'X-Glympse-User-Did': 'did:plc:abcdefghijklmnop',
};
const TRUSTED_ORIGIN = 'https://app.glympse.example';

const VALID_SESSION_ID = 'as_1234567890ab';

function makeBootstrapPayload() {
  return {
    session: {
      id: VALID_SESSION_ID,
      type: 'thread_summary',
      privacyMode: 'private',
      scope: { rootUri: 'at://did:plc:root/app.bsky.feed.post/1' },
      lookupKey: 'thread-summary:at://did:plc:root/app.bsky.feed.post/1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    members: [{ did: DID_HEADER['X-Glympse-User-Did'], role: 'owner', joinedAt: new Date().toISOString() }],
    capabilities: {
      canWriteMessages: true,
      canTriggerGeneration: true,
      canInvite: true,
      canViewArtifacts: true,
      canWritePresence: true,
    },
    messageHistory: [],
    stateSnapshot: {
      session: {
        id: VALID_SESSION_ID,
        type: 'thread_summary',
        privacyMode: 'private',
        scope: { rootUri: 'at://did:plc:root/app.bsky.feed.post/1' },
        lookupKey: 'thread-summary:at://did:plc:root/app.bsky.feed.post/1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      members: [],
      artifacts: [],
      activeGeneration: null,
    },
    eventOffset: 0,
    stateOffset: 0,
    presenceOffset: 0,
    activeGenerationInProgress: false,
  };
}

describe('aiSessionsRouter security/privacy behavior', () => {
  beforeEach(() => {
    resetAiSessionTelemetry();
    envMock.NODE_ENV = 'production';
    envMock.CORS_ALLOWED_ORIGINS = TRUSTED_ORIGIN;
    envMock.CORS_ALLOW_PRIVATE_NETWORK_IN_DEV = true;
    mockAssertSessionAccess.mockReset();
    mockBootstrapSession.mockReset();
    mockReadEventLane.mockReset();
    mockReadPresenceLane.mockReset();
    mockReadStateLane.mockReset();
    mockResolveThreadSummarySession.mockReset();
    mockProxyDurableRead.mockReset();
    mockWritePresence.mockReset();
    mockWriteSessionMessage.mockReset();
  });

  it('adds no-store private response headers for successful AI session responses', async () => {
    mockBootstrapSession.mockReturnValue(makeBootstrapPayload());

    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/bootstrap`, {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const vary = response.headers.get('vary')?.toLowerCase() ?? '';
    expect(vary).toContain('origin');
    expect(vary).toContain('x-glympse-user-did');
  });

  it('rejects malformed session ids at the route boundary', async () => {
    const response = await aiSessionsRouter.request('/bad/bootstrap', {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error?: string; code?: string };
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(payload.error).toContain('Invalid sessionId');
  });

  it('rejects malformed DID headers at the route boundary', async () => {
    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/bootstrap`, {
      method: 'GET',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'X-Glympse-User-Did': 'did:bad did',
      },
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: string; code?: string };
    expect(payload.code).toBe('UNAUTHORIZED');
    expect(payload.error).toContain('Invalid DID header format');
  });

  it('rejects missing origin headers in production for DID-keyed routes', async () => {
    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/bootstrap`, {
      method: 'GET',
      headers: DID_HEADER,
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error?: string; code?: string };
    expect(payload.code).toBe('FORBIDDEN');
    expect(payload.error).toContain('trusted browser origin');
  });

  it('rejects disallowed origins before serving AI session data', async () => {
    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/bootstrap`, {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: 'https://evil.example',
      },
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { error?: string; code?: string };
    expect(payload.code).toBe('FORBIDDEN');
    expect(payload.error).toContain('not allowed from this origin');
  });

  it('does not leak internal 5xx error details in production', async () => {
    mockWriteSessionMessage.mockRejectedValue(
      new AppError(500, 'UPSTREAM_ERROR', 'Sensitive upstream failure details', { secret: 'token' }),
    );

    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/messages`, {
      method: 'POST',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clientActionId: 'ca_1234567890ab',
        kind: 'message',
        content: 'hello',
      }),
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toBe('Internal server error');
    expect(payload.code).toBe('UPSTREAM_ERROR');
    expect(payload.details).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const vary = response.headers.get('vary')?.toLowerCase() ?? '';
    expect(vary).toContain('origin');
    expect(vary).toContain('x-glympse-user-did');
  });

  it('passes live lane reads through durable proxy when available', async () => {
    mockProxyDurableRead.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await aiSessionsRouter.request(`/${VALID_SESSION_ID}/events?offset=0&limit=50&live=true`, {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockAssertSessionAccess).toHaveBeenCalledWith(VALID_SESSION_ID, DID_HEADER['X-Glympse-User-Did']);
    expect(mockProxyDurableRead).toHaveBeenCalledWith('events', VALID_SESSION_ID, 'offset=0&limit=50&live=true');
    expect(mockReadEventLane).not.toHaveBeenCalled();
  });

  it('returns and resets AI session telemetry via protected endpoints', async () => {
    mockBootstrapSession.mockReturnValue(makeBootstrapPayload());

    await aiSessionsRouter.request(`/${VALID_SESSION_ID}/bootstrap`, {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });

    const snapshot = await aiSessionsRouter.request('/telemetry', {
      method: 'GET',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });

    expect(snapshot.status).toBe(200);
    const payload = await snapshot.json() as { telemetry?: ReturnType<typeof getAiSessionTelemetry> };
    expect(payload.telemetry).toBeTruthy();
    expect(payload.telemetry?.durableHydration).toBeTruthy();
    expect(payload.telemetry?.durableStrictReadFailures).toBeTruthy();

    const reset = await aiSessionsRouter.request('/telemetry', {
      method: 'DELETE',
      headers: {
        ...DID_HEADER,
        Origin: TRUSTED_ORIGIN,
      },
    });
    expect(reset.status).toBe(204);

    const afterReset = getAiSessionTelemetry();
    expect(afterReset.routeErrors).toBe(0);
    expect(afterReset.durableHydration.attempts).toBe(0);
    expect(afterReset.durableStrictReadFailures.events).toBe(0);
  });
});
