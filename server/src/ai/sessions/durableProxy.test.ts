import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    AI_DURABLE_EVENTS_READ_BASE_URL: 'https://durable.example/events',
    AI_DURABLE_STATE_READ_BASE_URL: 'https://durable.example/state',
    AI_DURABLE_PRESENCE_READ_BASE_URL: 'https://durable.example/presence',
    AI_DURABLE_READ_BEARER_TOKEN: 'read-token',
    AI_DURABLE_READ_TIMEOUT_MS: 12000,
    AI_DURABLE_RETRY_ATTEMPTS: 2,
  },
}));

vi.mock('../../config/env.js', () => ({
  env: envMock,
}));

describe('durable proxy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('routes reads to lane-specific base urls without duplicating lane path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { proxyDurableRead } = await import('./durableProxy.js');
    await proxyDurableRead('events', 'as_1234567890ab', 'offset=0&limit=10&live=true');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://durable.example/events/as_1234567890ab?offset=0&limit=10&live=true',
    );
  });
});