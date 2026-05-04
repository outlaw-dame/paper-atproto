import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    AI_DURABLE_EVENTS_READ_BASE_URL: 'https://durable.example/events',
    AI_DURABLE_STATE_READ_BASE_URL: 'https://durable.example/state',
    AI_DURABLE_PRESENCE_READ_BASE_URL: 'https://durable.example/presence',
    AI_DURABLE_EVENTS_WRITE_BASE_URL: 'https://durable.example/events',
    AI_DURABLE_STATE_WRITE_BASE_URL: 'https://durable.example/state',
    AI_DURABLE_PRESENCE_WRITE_BASE_URL: 'https://durable.example/presence',
    AI_DURABLE_READ_BEARER_TOKEN: 'read-token',
    AI_DURABLE_WRITE_BEARER_TOKEN: 'write-token',
    AI_DURABLE_READ_TIMEOUT_MS: 12000,
    AI_DURABLE_WRITE_TIMEOUT_MS: 12000,
    AI_DURABLE_RETRY_ATTEMPTS: 2,
  },
}));

vi.mock('../../config/env.js', () => ({
  env: envMock,
}));

describe('durable transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('includes an idempotency key on append writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => '13') },
      json: vi.fn(async () => ({})),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { appendDurableMessage } = await import(`./durableTransport.js?test=${Date.now()}`);
    const payload = {
      v: 1 as const,
      kind: 'generation.status' as const,
      id: 'evt_abc123',
      sessionId: 'as_1234567890ab',
      status: 'running' as const,
      createdAt: new Date().toISOString(),
    };

    const result = await appendDurableMessage('events', 'as_1234567890ab', payload);
    expect(result.offset).toBe(13);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('events:as_1234567890ab:evt_abc123');
  });

  it('uses header next-offset when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn((name: string) => {
          if (name.toLowerCase() === 'x-next-offset') return '42';
          return null;
        }),
      },
      json: vi.fn(async () => ({ items: [{ offset: 5, payload: { any: true } }] })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { readDurableLane } = await import(`./durableTransport.js?test=${Date.now()}`);
    const result = await readDurableLane('events', 'as_1234567890ab', 0, 200);

    expect(result?.nextOffset).toBe(42);
    expect(result?.items).toHaveLength(1);
  });
});
