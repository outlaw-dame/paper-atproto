import { beforeEach, describe, expect, it, vi } from 'vitest';

type ThreatEntry = {
  threatType: string;
  platformType: string;
  threatEntryType: string;
  url: string;
};

const NO_THREATS: ThreatEntry[] = [];

const {
  envMock,
  mockAppendDurableMessage,
  mockDurableLaneConfigured,
  mockEnsureDurableStream,
  mockReadDurableLane,
  mockRecordDedupEviction,
  mockRecordDroppedInvalidDurablePayload,
  mockRecordDurableHydrationAttempt,
  mockRecordDurableHydrationFailure,
  mockRecordDurableHydrationMiss,
  mockRecordDurableHydrationSuccess,
  mockRecordDurableFailOpenFallback,
  mockRecordDurableStrictReadFailure,
  mockRecordDurableStrictWriteFailure,
  mockRecordMetadataSanitizationMutation,
  mockCheckUrlAgainstSafeBrowsing,
} = vi.hoisted(() => ({
  envMock: {
    AI_DURABLE_FAIL_OPEN: false,
    AI_SAFE_BROWSING_FAIL_CLOSED: false,
  },
  mockAppendDurableMessage: vi.fn(),
  mockDurableLaneConfigured: vi.fn(() => false),
  mockEnsureDurableStream: vi.fn(),
  mockReadDurableLane: vi.fn(),
  mockRecordDedupEviction: vi.fn(),
  mockRecordDroppedInvalidDurablePayload: vi.fn(),
  mockRecordDurableHydrationAttempt: vi.fn(),
  mockRecordDurableHydrationFailure: vi.fn(),
  mockRecordDurableHydrationMiss: vi.fn(),
  mockRecordDurableHydrationSuccess: vi.fn(),
  mockRecordDurableFailOpenFallback: vi.fn(),
  mockRecordDurableStrictReadFailure: vi.fn(),
  mockRecordDurableStrictWriteFailure: vi.fn(),
  mockRecordMetadataSanitizationMutation: vi.fn(),
  mockCheckUrlAgainstSafeBrowsing: vi.fn(async (url: string) => ({
    url,
    checked: true,
    status: 'safe',
    safe: true,
    blocked: false,
    threats: NO_THREATS,
  })),
}));

vi.mock('../../server/src/config/env.js', () => ({
  env: envMock,
}));

vi.mock('../../server/src/ai/sessions/durableTransport.js', () => ({
  appendDurableMessage: mockAppendDurableMessage,
  durableLaneConfigured: mockDurableLaneConfigured,
  ensureDurableStream: mockEnsureDurableStream,
  readDurableLane: mockReadDurableLane,
}));

vi.mock('../../server/src/ai/sessions/telemetry.js', () => ({
  recordDedupEviction: mockRecordDedupEviction,
  recordDroppedInvalidDurablePayload: mockRecordDroppedInvalidDurablePayload,
  recordDurableHydrationAttempt: mockRecordDurableHydrationAttempt,
  recordDurableHydrationFailure: mockRecordDurableHydrationFailure,
  recordDurableHydrationMiss: mockRecordDurableHydrationMiss,
  recordDurableHydrationSuccess: mockRecordDurableHydrationSuccess,
  recordMetadataSanitizationMutation: mockRecordMetadataSanitizationMutation,
  recordDurableFailOpenFallback: mockRecordDurableFailOpenFallback,
  recordDurableStrictReadFailure: mockRecordDurableStrictReadFailure,
  recordDurableStrictWriteFailure: mockRecordDurableStrictWriteFailure,
}));

vi.mock('../../server/src/services/safeBrowsing.js', () => ({
  checkUrlAgainstSafeBrowsing: mockCheckUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict: (verdict: {
    blocked: boolean;
    status: 'safe' | 'unsafe' | 'unknown';
  }) => verdict.blocked || (envMock.AI_SAFE_BROWSING_FAIL_CLOSED && verdict.status === 'unknown'),
}));

import {
  bootstrapSession,
  readEventLane,
  resolveThreadSummarySession,
  writeSessionMessage,
} from '../../server/src/ai/sessions/store.js';

const DID = 'did:plc:abcdefghijklmnop';
const ROOT_URI = 'at://did:plc:root/app.bsky.feed.post/1';

describe('ai sessions durable policy', () => {
  beforeEach(() => {
    envMock.AI_DURABLE_FAIL_OPEN = false;
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = false;

    mockAppendDurableMessage.mockReset();
    mockDurableLaneConfigured.mockReset();
    mockEnsureDurableStream.mockReset();
    mockReadDurableLane.mockReset();
    mockRecordDedupEviction.mockReset();
    mockRecordDroppedInvalidDurablePayload.mockReset();
    mockRecordDurableHydrationAttempt.mockReset();
    mockRecordDurableHydrationFailure.mockReset();
    mockRecordDurableHydrationMiss.mockReset();
    mockRecordDurableHydrationSuccess.mockReset();
    mockRecordDurableFailOpenFallback.mockReset();
    mockRecordDurableStrictReadFailure.mockReset();
    mockRecordDurableStrictWriteFailure.mockReset();
    mockRecordMetadataSanitizationMutation.mockReset();
    mockCheckUrlAgainstSafeBrowsing.mockReset();

    mockDurableLaneConfigured.mockImplementation(() => false);
    mockAppendDurableMessage.mockResolvedValue({ offset: null });
    mockReadDurableLane.mockResolvedValue(null);
    mockCheckUrlAgainstSafeBrowsing.mockImplementation(async (url: string) => ({
      url,
      checked: true,
      status: 'safe',
      safe: true,
      blocked: false,
      threats: NO_THREATS,
    }));
  });

  it('fails closed with 503 when durable writes fail in strict mode', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    mockDurableLaneConfigured.mockImplementation(() => true);
    mockAppendDurableMessage.mockRejectedValue(new Error('durable write outage'));

    await expect(
      writeSessionMessage(session.id, DID, {
        clientActionId: 'ca_1234567890ab',
        kind: 'message',
        content: 'hello from strict mode',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_ERROR',
    });

    expect(mockRecordDurableStrictWriteFailure).toHaveBeenCalledWith('events');
    expect(mockRecordDurableFailOpenFallback).not.toHaveBeenCalled();
  });

  it('falls back to local lane data when durable fails and fail-open is enabled', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    envMock.AI_DURABLE_FAIL_OPEN = true;
    mockDurableLaneConfigured.mockImplementation(() => true);
    mockAppendDurableMessage.mockRejectedValue(new Error('durable write outage'));

    const writeResult = await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_abcdef123456',
      kind: 'message',
      content: 'hello from fail open',
    });

    expect(writeResult.accepted).toBe(true);
    expect(mockRecordDurableFailOpenFallback).toHaveBeenCalled();

    mockReadDurableLane.mockRejectedValue(new Error('durable read outage'));

    const lane = await readEventLane(session.id, DID, 0, 200);
    expect(lane.items.length).toBeGreaterThan(0);
    expect(lane.items.some((entry) => entry.payload.kind === 'message.user')).toBe(true);
    expect(mockRecordDurableFailOpenFallback).toHaveBeenCalledWith('events');
  });

  it('does not duplicate local lane entries when durable replays an existing offset', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    envMock.AI_DURABLE_FAIL_OPEN = true;
    mockDurableLaneConfigured.mockImplementation(() => true);

    await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_dedup_offset_001',
      kind: 'message',
      content: 'baseline lane content',
    });

    mockReadDurableLane.mockResolvedValueOnce(null);
    const beforeReplay = await readEventLane(session.id, DID, 0, 500);
    const baselineCount = beforeReplay.items.length;

    mockReadDurableLane.mockResolvedValueOnce({
      items: [
        {
          offset: 0,
          payload: {
            v: 1,
            kind: 'message.user',
            id: 'evt_durable_replay_existing_offset_0',
            sessionId: session.id,
            authorId: DID,
            text: 'replayed message at existing offset',
            createdAt: new Date().toISOString(),
          },
        },
      ],
      nextOffset: 1,
    });

    await readEventLane(session.id, DID, 0, 500);

    mockReadDurableLane.mockResolvedValueOnce(null);
    const afterReplay = await readEventLane(session.id, DID, 0, 500);
    expect(afterReplay.items.length).toBe(baselineCount);
  });

  it('records metadata sanitation mutations for unsafe message metadata', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_meta_sanitize_001',
      kind: 'message',
      content: 'metadata sanitization check',
      metadata: {
        __proto__: 'drop-me',
        safe: 'value',
        nested: {
          constructor: 'drop-me',
          key: 'value\u0000with-control',
        },
      },
    });

    expect(mockRecordMetadataSanitizationMutation).toHaveBeenCalledTimes(1);
  });

  it('does not record metadata sanitation mutations for clean message metadata', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_meta_clean_001',
      kind: 'message',
      content: 'clean metadata check',
      metadata: {
        safe: 'value',
        nested: {
          key: 'plain text',
          flag: true,
          count: 3,
        },
      },
    });

    expect(mockRecordMetadataSanitizationMutation).not.toHaveBeenCalled();
  });

  it('checks URLs in message content with Safe Browsing', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_safe_url_001',
      kind: 'message',
      content: 'review this https://example.com/resource and https://example.org/info',
    });

    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledTimes(2);
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://example.com/resource');
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://example.org/info');
  });

  it('filters local/private URLs and strips tracking fragments before Safe Browsing checks', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    await writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_safe_url_sanitize_001',
      kind: 'message',
      content: [
        'public https://example.com/path?utm_source=newsletter&id=42#frag',
        'local http://localhost:3000/private',
        'private http://192.168.1.20/secret',
      ].join(' '),
    });

    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledTimes(1);
    expect(mockCheckUrlAgainstSafeBrowsing).toHaveBeenCalledWith('https://example.com/path?id=42');
  });

  it('rejects messages containing Safe Browsing-blocked URLs', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');

    mockCheckUrlAgainstSafeBrowsing.mockImplementationOnce(async (url: string) => ({
      url,
      checked: true,
      status: 'unsafe',
      safe: false,
      blocked: true,
      reason: 'URL matched one or more Safe Browsing threat lists.',
      threats: [{
        threatType: 'MALWARE',
        platformType: 'ANY_PLATFORM',
        threatEntryType: 'URL',
        url,
      }],
    }));

    await expect(writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_blocked_url_001',
      kind: 'message',
      content: 'please open https://malicious.example/',
    })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects unknown Safe Browsing verdicts when fail-closed is enabled', async () => {
    const session = await resolveThreadSummarySession(ROOT_URI, DID, 'private');
    envMock.AI_SAFE_BROWSING_FAIL_CLOSED = true;

    mockCheckUrlAgainstSafeBrowsing.mockImplementationOnce(async (url: string) => ({
      url,
      checked: false,
      status: 'unknown',
      safe: true,
      blocked: false,
      reason: 'Safe Browsing request timed out.',
      threats: [],
    }));

    await expect(writeSessionMessage(session.id, DID, {
      clientActionId: 'ca_unknown_url_001',
      kind: 'message',
      content: 'please open https://unknown-status.example/',
    })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('reconstructs session bootstrap and lanes from durable state after cold start', async () => {
    const coldSessionId = 'as_coldstart_hydration_001';
    const createdAt = new Date('2026-04-02T00:00:00.000Z').toISOString();
    const metadata = {
      id: coldSessionId,
      type: 'thread_summary' as const,
      privacyMode: 'private' as const,
      scope: { rootUri: ROOT_URI },
      lookupKey: `thread-summary:${ROOT_URI}`,
      createdAt,
      updatedAt: createdAt,
    };

    mockDurableLaneConfigured.mockImplementation(() => true);
    mockReadDurableLane.mockImplementation(async (lane: string, sessionId: string, offset: number) => {
      if (sessionId !== coldSessionId) return null;

      if (lane === 'state') {
        if (offset > 0) {
          return { items: [], nextOffset: 4 };
        }
        return {
          items: [
            {
              offset: 0,
              payload: {
                v: 1,
                id: 'state_session_insert_0001',
                sessionId: coldSessionId,
                createdAt,
                collection: 'session',
                operation: 'insert',
                key: coldSessionId,
                value: metadata,
              },
            },
            {
              offset: 1,
              payload: {
                v: 1,
                id: 'state_member_insert_0001',
                sessionId: coldSessionId,
                createdAt,
                collection: 'member',
                operation: 'insert',
                key: DID,
                value: {
                  did: DID,
                  role: 'owner',
                  joinedAt: createdAt,
                },
              },
            },
            {
              offset: 2,
              payload: {
                v: 1,
                id: 'state_artifact_update_0001',
                sessionId: coldSessionId,
                createdAt,
                collection: 'artifact',
                operation: 'update',
                key: 'current-summary',
                value: {
                  id: 'current-summary',
                  kind: 'threadSummary',
                  content: 'Recovered durable summary',
                  updatedAt: createdAt,
                  status: 'ready',
                },
              },
            },
            {
              offset: 3,
              payload: {
                v: 1,
                id: 'state_tool_run_0001',
                sessionId: coldSessionId,
                createdAt,
                collection: 'toolRun',
                operation: 'update',
                key: 'run_recovered',
                value: {
                  runId: 'run_recovered',
                  status: 'completed',
                },
              },
            },
          ],
          nextOffset: 4,
        };
      }

      if (lane === 'events') {
        if (offset > 0) {
          return { items: [], nextOffset: 2 };
        }
        return {
          items: [
            {
              offset: 0,
              payload: {
                v: 1,
                kind: 'message.user',
                id: 'evt_user_message_0001',
                sessionId: coldSessionId,
                authorId: DID,
                text: 'Recovered durable user message',
                createdAt,
              },
            },
            {
              offset: 1,
              payload: {
                v: 1,
                kind: 'message.assistant',
                id: 'evt_assistant_message_0001',
                sessionId: coldSessionId,
                text: 'Recovered durable assistant message',
                createdAt,
                final: true,
              },
            },
          ],
          nextOffset: 2,
        };
      }

      if (lane === 'presence') {
        if (offset > 0) {
          return { items: [], nextOffset: 1 };
        }
        return {
          items: [
            {
              offset: 0,
              payload: {
                v: 1,
                id: 'presence_event_0001',
                sessionId: coldSessionId,
                createdAt,
                userId: DID,
                isTyping: false,
                expiresAt: createdAt,
              },
            },
          ],
          nextOffset: 1,
        };
      }

      return null;
    });

    const bootstrap = await bootstrapSession(coldSessionId, DID);
    expect(bootstrap.session.id).toBe(coldSessionId);
    expect(bootstrap.messageHistory.some((item) => item.kind === 'message.user')).toBe(true);
    expect(bootstrap.messageHistory.some((item) => item.kind === 'message.assistant')).toBe(true);
    expect(bootstrap.stateSnapshot.artifacts).toEqual([
      expect.objectContaining({
        id: 'current-summary',
        content: 'Recovered durable summary',
      }),
    ]);
    expect(bootstrap.eventOffset).toBe(2);
    expect(bootstrap.stateOffset).toBe(4);
    expect(bootstrap.presenceOffset).toBe(1);
    expect(mockRecordDurableHydrationAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordDurableHydrationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      replayedItems: {
        events: 2,
        state: 4,
        presence: 1,
      },
      replayedPages: {
        events: 1,
        state: 1,
        presence: 1,
      },
    }));

    const lane = await readEventLane(coldSessionId, DID, 0, 50);
    expect(lane.items.length).toBe(2);
    expect(lane.nextOffset).toBe(2);
  });

  it('records hydration miss telemetry when no durable lanes exist', async () => {
    mockDurableLaneConfigured.mockImplementation(() => true);
    mockReadDurableLane.mockResolvedValue(null);

    await expect(bootstrapSession('as_hydration_miss_0001', DID)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect(mockRecordDurableHydrationAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordDurableHydrationMiss).toHaveBeenCalledTimes(1);
    expect(mockRecordDurableHydrationFailure).not.toHaveBeenCalled();
  });

  it('fails hydration in strict mode when durable reads error and records strict read failure telemetry', async () => {
    mockDurableLaneConfigured.mockImplementation(() => true);
    mockReadDurableLane.mockRejectedValue(new Error('durable read outage'));

    await expect(bootstrapSession('as_hydration_strict_0001', DID)).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_ERROR',
    });

    expect(mockRecordDurableStrictReadFailure).toHaveBeenCalledWith('state');
    expect(mockRecordDurableHydrationAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordDurableHydrationFailure).toHaveBeenCalledTimes(1);
  });

  it('hydrates across multiple durable pages for large event lanes', async () => {
    const coldSessionId = 'as_coldstart_multipage_0001';
    const createdAt = new Date('2026-04-02T00:00:00.000Z').toISOString();

    const firstPageEvents = Array.from({ length: 500 }, (_, index) => ({
      offset: index,
      payload: {
        v: 1,
        kind: 'message.user' as const,
        id: `evt_page1_${String(index).padStart(4, '0')}`,
        sessionId: coldSessionId,
        authorId: DID,
        text: `page1-${index}`,
        createdAt,
      },
    }));

    mockDurableLaneConfigured.mockImplementation(() => true);
    mockReadDurableLane.mockImplementation(async (lane: string, sessionId: string, offset: number) => {
      if (sessionId !== coldSessionId) return null;

      if (lane === 'state') {
        if (offset > 0) {
          return { items: [], nextOffset: 1 };
        }
        return {
          items: [
            {
              offset: 0,
              payload: {
                v: 1,
                id: 'state_session_insert_multi_0001',
                sessionId: coldSessionId,
                createdAt,
                collection: 'session',
                operation: 'insert',
                key: coldSessionId,
                value: {
                  id: coldSessionId,
                  type: 'thread_summary',
                  privacyMode: 'private',
                  scope: { rootUri: ROOT_URI },
                  lookupKey: `thread-summary:${ROOT_URI}`,
                  createdAt,
                  updatedAt: createdAt,
                },
              },
            },
          ],
          nextOffset: 1,
        };
      }

      if (lane === 'events') {
        if (offset === 0) {
          return {
            items: firstPageEvents,
            nextOffset: 500,
          };
        }
        if (offset === 500) {
          return {
            items: [
              {
                offset: 500,
                payload: {
                  v: 1,
                  kind: 'message.assistant',
                  id: 'evt_page2_assistant_0001',
                  sessionId: coldSessionId,
                  text: 'page2-assistant',
                  createdAt,
                  final: true,
                },
              },
            ],
            nextOffset: 501,
          };
        }
        return { items: [], nextOffset: 501 };
      }

      if (lane === 'presence') {
        return { items: [], nextOffset: 0 };
      }

      return null;
    });

    const bootstrap = await bootstrapSession(coldSessionId, DID);
    expect(bootstrap.eventOffset).toBe(501);
    expect(bootstrap.messageHistory.length).toBe(501);
    expect(bootstrap.messageHistory.some((event) => event.kind === 'message.assistant')).toBe(true);
    expect(mockRecordDurableHydrationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      replayedItems: {
        events: 501,
        state: 1,
        presence: 0,
      },
      replayedPages: {
        events: 2,
        state: 1,
        presence: 1,
      },
    }));
    expect(mockReadDurableLane).toHaveBeenCalledWith('events', coldSessionId, 500, 500);
  });
});
