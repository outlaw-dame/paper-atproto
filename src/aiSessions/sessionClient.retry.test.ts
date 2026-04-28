import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sleepWithAbortMock } = vi.hoisted(() => ({
  sleepWithAbortMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/abortSignals', async () => {
  const actual = await vi.importActual('../lib/abortSignals');
  return {
    ...actual,
    sleepWithAbort: sleepWithAbortMock,
  };
});

import {
  bootstrapAiSession,
  resolveThreadSummarySession,
  sendSessionMessage,
  sendTypingPresence,
} from './sessionClient';

const VALID_SESSION_ID = 'as_1234567890ab' as const;
const VALID_DID = 'did:plc:abcdefghijklmnop';

function bootstrapPayload() {
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
    members: [{ did: VALID_DID, role: 'owner', joinedAt: new Date().toISOString() }],
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

describe('sessionClient retry policy', () => {
  beforeEach(() => {
    sleepWithAbortMock.mockClear();
    vi.restoreAllMocks();
  });

  it('does not retry non-retryable client errors', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('invalid request', { status: 400 }));

    await expect(bootstrapAiSession(VALID_SESSION_ID, VALID_DID)).rejects.toThrow(/Request failed 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('retries transient upstream failures with backoff', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bootstrapPayload()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await bootstrapAiSession(VALID_SESSION_ID, VALID_DID);
    expect(result.session.id).toBe(VALID_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After header when retrying 503 responses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('temporary outage', {
        status: 503,
        headers: {
          'retry-after': '3',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(bootstrapPayload()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await bootstrapAiSession(VALID_SESSION_ID, VALID_DID);
    expect(result.session.id).toBe(VALID_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
    const firstSleepCall = (sleepWithAbortMock.mock.calls as unknown[][])[0];
    expect(firstSleepCall?.[0]).toBe(3000);
  });

  it('retries transient network failures', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify(bootstrapPayload()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await bootstrapAiSession(VALID_SESSION_ID, VALID_DID);
    expect(result.session.id).toBe(VALID_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-transient thrown errors', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new SyntaxError('bad local configuration'));

    await expect(bootstrapAiSession(VALID_SESSION_ID, VALID_DID)).rejects.toThrow(/bad local configuration/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('retries internal timeout aborts before succeeding', async () => {
    const timeoutAbort = new DOMException('timed out', 'AbortError');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(timeoutAbort)
      .mockResolvedValueOnce(new Response(JSON.stringify(bootstrapPayload()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    const result = await bootstrapAiSession(VALID_SESSION_ID, VALID_DID);
    expect(result.session.id).toBe(VALID_SESSION_ID);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepWithAbortMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast on malformed DID input without sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(bootstrapAiSession(VALID_SESSION_ID, 'did:bad did')).rejects.toThrow(/invalid did format/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('fails fast on malformed sessionId without sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(bootstrapAiSession('bad-session-id' as typeof VALID_SESSION_ID, VALID_DID)).rejects.toThrow(/invalid session id format/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('fails fast when message content sanitizes to empty', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(sendSessionMessage(VALID_SESSION_ID, VALID_DID, {
      clientActionId: 'client_action_12345',
      kind: 'message',
      content: ' \n\t\r ',
    })).rejects.toThrow(/content is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('fails fast on malformed clientActionId without sending a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(sendSessionMessage(VALID_SESSION_ID, VALID_DID, {
      clientActionId: 'bad action id',
      kind: 'message',
      content: 'hello world',
    })).rejects.toThrow(/invalid clientactionid format/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('clamps presence expiresInMs into server-accepted range', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    await sendTypingPresence(VALID_SESSION_ID, VALID_DID, true, 99_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = requestInit?.body as string;
    expect(body).toContain('"expiresInMs":10000');
  });

  it('clamps low presence expiresInMs into server-accepted range', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    await sendTypingPresence(VALID_SESSION_ID, VALID_DID, true, 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = requestInit?.body as string;
    expect(body).toContain('"expiresInMs":1000');
  });

  it('fails fast when rootUri sanitizes to empty', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(resolveThreadSummarySession(' \n\t\r ', VALID_DID)).rejects.toThrow(/rooturi is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sleepWithAbortMock).not.toHaveBeenCalled();
  });

  it('sanitizes outbound metadata keys and values', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }));

    await sendSessionMessage(VALID_SESSION_ID, VALID_DID, {
      clientActionId: 'client_action_12345',
      kind: 'message',
      content: 'hello world',
      metadata: {
        __proto__: 'drop-me',
        clean: 'ok',
        nested: {
          constructor: 'drop-me',
          key: 'value\u0000with-control',
        },
        items: ['a', 'b', { prototype: 'drop-me', safe: true }],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse((requestInit?.body as string) ?? '{}') as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    expect(metadata.clean).toBe('ok');
    expect(metadata).not.toHaveProperty('__proto__');
    const nested = metadata.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('constructor');
    expect(nested.key).toBe('value with-control');
  });
});
