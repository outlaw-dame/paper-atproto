import { randomUUID } from 'node:crypto';
import {
  AiSessionEventSchema,
  MemberSchema,
  PresenceEventSchema,
  SessionMetadataSchema,
  StateEventSchema,
  type AiSessionEvent,
  type Member,
  type PresenceEvent,
  type SessionMetadata,
  type SessionPrivacyMode,
  type StateEvent,
  roleCapabilities,
} from './schemas.js';
import { UpstreamError, ValidationError, UnauthorizedError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import {
  appendDurableMessage,
  durableLaneConfigured,
  ensureDurableStream,
  readDurableLane,
} from './durableTransport.js';
import {
  recordDedupEviction,
  recordDurableHydrationAttempt,
  recordDurableHydrationFailure,
  recordDurableHydrationMiss,
  recordDurableHydrationSuccess,
  recordDroppedInvalidDurablePayload,
  recordDurableStrictReadFailure,
  recordMetadataSanitizationMutation,
  recordDurableFailOpenFallback,
  recordDurableStrictWriteFailure,
} from './telemetry.js';
import {
  checkUrlAgainstSafeBrowsing,
  shouldBlockSafeBrowsingVerdict,
} from '../../services/safeBrowsing.js';
import { sanitizeRemoteProcessingUrl } from '../../lib/sanitize.js';

type DurableLane = 'events' | 'state' | 'presence';

type LaneEnvelope<T> = {
  offset: number;
  payload: T;
};

type ThreadSummaryState = {
  activeGeneration: {
    runId: string;
    startedAt: string;
    status: 'running' | 'completed' | 'cancelled' | 'failed';
    branchId: string;
  } | null;
  artifacts: Array<{
    id: string;
    kind: 'threadSummary';
    content: string;
    updatedAt: string;
    status: 'ready' | 'failed';
  }>;
};

type StoredSession = {
  metadata: SessionMetadata;
  members: Map<string, Member>;
  eventLane: LaneEnvelope<AiSessionEvent>[];
  stateLane: LaneEnvelope<StateEvent>[];
  presenceLane: LaneEnvelope<PresenceEvent>[];
  actionDedup: Set<string>;
  state: ThreadSummaryState;
  nextOffsets: {
    event: number;
    state: number;
    presence: number;
  };
};

type ToolRunStateValue = {
  runId?: unknown;
  status?: unknown;
  branchId?: unknown;
};

const sessionsById = new Map<string, StoredSession>();
const lookupToSessionId = new Map<string, string>();

const MAX_LANE_LENGTH = 5000;
const MAX_ACTION_DEDUP = 20_000;
const MAX_URL_CHECKS_PER_MESSAGE = 8;

function nowIso(): string {
  return new Date().toISOString();
}

function makeSessionId(): string {
  return `as_${randomUUID().replace(/-/g, '')}`;
}

function newEventId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function trimLane<T>(lane: LaneEnvelope<T>[]): void {
  if (lane.length <= MAX_LANE_LENGTH) return;
  lane.splice(0, lane.length - MAX_LANE_LENGTH);
}

function pushLaneEvent<T>(lane: LaneEnvelope<T>[], offset: number, payload: T): number {
  lane.push({ offset, payload });
  trimLane(lane);
  return offset;
}

function laneHasOffset<T>(lane: LaneEnvelope<T>[], offset: number): boolean {
  return lane.some((entry) => entry.offset === offset);
}

function normalizeLookupKey(rootUri: string): string {
  return `thread-summary:${rootUri.trim()}`;
}

function sanitizeText(input: string, maxLen: number): string {
  const trimmed = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function sanitizeArtifactId(input: string | undefined): string {
  if (!input) return 'current-summary';
  const clean = sanitizeText(input, 128).replace(/[^a-zA-Z0-9._:-]/g, '_');
  return clean || 'current-summary';
}

function sanitizeUnknownJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null) return null;

  const kind = typeof value;
  if (kind === 'string') return sanitizeText(value as string, 300);
  if (kind === 'number') return Number.isFinite(value) ? value : null;
  if (kind === 'boolean') return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).slice(0, 50).map((item) => sanitizeUnknownJson(item, depth + 1));
  }
  if (kind === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(source)) {
      if (count >= 50) break;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const safeKey = sanitizeText(key, 64);
      if (!safeKey) continue;
      target[safeKey] = sanitizeUnknownJson(nested, depth + 1);
      count += 1;
    }
    return target;
  }

  return null;
}

function extractHttpUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const sanitized = sanitizeRemoteProcessingUrl(raw);
    if (!sanitized) continue;
    if (seen.has(sanitized)) continue;
    seen.add(sanitized);
    unique.push(sanitized);
    if (unique.length >= MAX_URL_CHECKS_PER_MESSAGE) break;
  }

  return unique;
}

async function assertNoUnsafeUrlsInMessageContent(content: string): Promise<void> {
  const urls = extractHttpUrls(content);
  if (urls.length === 0) return;

  const results = await Promise.all(urls.map((url) => checkUrlAgainstSafeBrowsing(url)));
  const blocked = results.filter((result) => shouldBlockSafeBrowsingVerdict(result));
  if (blocked.length === 0) return;

  throw new ValidationError('Message contains one or more unsafe URLs', {
    blockedUrls: blocked.map((result) => result.url),
    threatTypes: blocked.flatMap((result) => result.threats.map((threat) => threat.threatType)),
  });
}

function pushActionDedup(session: StoredSession, idempotencyKey: string): void {
  session.actionDedup.add(idempotencyKey);
  if (session.actionDedup.size <= MAX_ACTION_DEDUP) return;
  const oldest = session.actionDedup.values().next().value;
  if (oldest) {
    session.actionDedup.delete(oldest);
    recordDedupEviction();
  }
}

function getMemberOrThrow(session: StoredSession, did: string): Member {
  const member = session.members.get(did);
  if (!member) {
    throw new UnauthorizedError('You are not a member of this session');
  }
  return member;
}

async function appendDurableWithPolicy(
  lane: DurableLane,
  sessionId: string,
  payload: AiSessionEvent | StateEvent | PresenceEvent,
): Promise<{ offset: number | null }> {
  try {
    return await appendDurableMessage(lane, sessionId, payload);
  } catch {
    if (env.AI_DURABLE_FAIL_OPEN || !durableLaneConfigured(lane)) {
      recordDurableFailOpenFallback(lane);
      return { offset: null };
    }
    recordDurableStrictWriteFailure(lane);
    throw new UpstreamError(`Durable ${lane} write failed`, { lane }, 503);
  }
}

async function readDurableWithPolicy<T>(
  lane: DurableLane,
  sessionId: string,
  offset: number,
  limit: number,
) {
  try {
    return await readDurableLane<T>(lane, sessionId, offset, limit);
  } catch {
    if (env.AI_DURABLE_FAIL_OPEN || !durableLaneConfigured(lane)) {
      recordDurableFailOpenFallback(lane);
      return null;
    }
    recordDurableStrictReadFailure(lane);
    throw new UpstreamError(`Durable ${lane} read failed`, { lane }, 503);
  }
}

async function appendStateEvent(session: StoredSession, event: StateEvent): Promise<number> {
  const durable = await appendDurableWithPolicy('state', session.metadata.id, event);
  const resolvedOffset = durable.offset ?? session.nextOffsets.state;
  const offset = pushLaneEvent(session.stateLane, resolvedOffset, event);
  session.nextOffsets.state = Math.max(session.nextOffsets.state, offset + 1);
  return offset;
}

async function appendEvent(session: StoredSession, event: AiSessionEvent): Promise<number> {
  const durable = await appendDurableWithPolicy('events', session.metadata.id, event);
  const resolvedOffset = durable.offset ?? session.nextOffsets.event;
  const offset = pushLaneEvent(session.eventLane, resolvedOffset, event);
  session.nextOffsets.event = Math.max(session.nextOffsets.event, offset + 1);
  return offset;
}

async function appendPresence(session: StoredSession, event: PresenceEvent): Promise<number> {
  const durable = await appendDurableWithPolicy('presence', session.metadata.id, event);
  const resolvedOffset = durable.offset ?? session.nextOffsets.presence;
  const offset = pushLaneEvent(session.presenceLane, resolvedOffset, event);
  session.nextOffsets.presence = Math.max(session.nextOffsets.presence, offset + 1);
  return offset;
}

function setOffsetFromLane(session: StoredSession): void {
  session.nextOffsets.event = (session.eventLane.at(-1)?.offset ?? -1) + 1;
  session.nextOffsets.state = (session.stateLane.at(-1)?.offset ?? -1) + 1;
  session.nextOffsets.presence = (session.presenceLane.at(-1)?.offset ?? -1) + 1;
}

function ensureSessionOffsetsHealthy(session: StoredSession): void {
  if (session.nextOffsets.event < 0 || session.nextOffsets.state < 0 || session.nextOffsets.presence < 0) {
    setOffsetFromLane(session);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asSessionMetadata(value: unknown): SessionMetadata | null {
  const parsed = SessionMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asMember(value: unknown): Member | null {
  const parsed = MemberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asArtifact(value: unknown): ThreadSummaryState['artifacts'][number] | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = typeof record.id === 'string' ? sanitizeArtifactId(record.id) : null;
  const kind = record.kind === 'threadSummary' ? 'threadSummary' : null;
  const content = typeof record.content === 'string' ? sanitizeText(record.content, 12_000) : '';
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : nowIso();
  const status = record.status === 'ready' || record.status === 'failed' ? record.status : 'ready';

  if (!id || !kind) return null;
  return { id, kind, content, updatedAt, status };
}

function ensureHydratedMetadata(
  metadata: SessionMetadata | null,
  sessionId: string,
  rootUri: string,
  lookupKey: string,
  createdAt: string,
): SessionMetadata {
  if (metadata) return metadata;
  return {
    id: sessionId,
    type: 'thread_summary',
    privacyMode: 'private',
    scope: { rootUri },
    lookupKey,
    createdAt,
    updatedAt: createdAt,
  };
}

function applyStateEventToHydratedSession(session: StoredSession, event: StateEvent): void {
  if (event.collection === 'session') {
    if ((event.operation === 'insert' || event.operation === 'update') && event.key === session.metadata.id) {
      const metadata = asSessionMetadata(event.value);
      if (metadata) {
        session.metadata = metadata;
      }
    }
    const record = asRecord(event.value);
    if (record && event.operation === 'snapshot-start') {
      const metadata = asSessionMetadata(record.metadata ?? record.session ?? record.value);
      if (metadata) {
        session.metadata = metadata;
      }
    }
  }

  if (event.collection === 'member') {
    if (event.operation === 'delete') {
      session.members.delete(event.key);
    } else {
      const member = asMember(event.value);
      if (member) {
        session.members.set(member.did, member);
      }
    }
  }

  if (event.collection === 'artifact') {
    if (event.operation === 'delete') {
      session.state.artifacts = session.state.artifacts.filter((artifact) => artifact.id !== event.key);
    } else {
      const artifact = asArtifact(event.value);
      if (artifact) {
        const idx = session.state.artifacts.findIndex((item) => item.id === artifact.id);
        if (idx >= 0) {
          session.state.artifacts[idx] = artifact;
        } else {
          session.state.artifacts.push(artifact);
        }
      }
    }
  }

  if (event.collection === 'toolRun') {
    if (event.operation === 'delete') {
      if (session.state.activeGeneration?.runId === event.key) {
        session.state.activeGeneration = null;
      }
      return;
    }
    const value = asRecord(event.value) as ToolRunStateValue | null;
    const runId = typeof value?.runId === 'string' ? value.runId : event.key;
    const status = value?.status === 'running'
      || value?.status === 'completed'
      || value?.status === 'cancelled'
      || value?.status === 'failed'
      ? value.status
      : null;
    if (!runId || !status) return;

    if (status === 'running') {
      const branchId = typeof value?.branchId === 'string' ? value.branchId : 'main';
      const startedAt = session.state.activeGeneration?.runId === runId
        ? session.state.activeGeneration.startedAt
        : event.createdAt;
      session.state.activeGeneration = {
        runId,
        startedAt,
        status,
        branchId,
      };
      return;
    }

    if (session.state.activeGeneration?.runId === runId) {
      session.state.activeGeneration = {
        ...session.state.activeGeneration,
        status,
      };
    }
  }
}

async function readDurableLaneFully<T extends AiSessionEvent | StateEvent | PresenceEvent>(
  lane: DurableLane,
  sessionId: string,
  parser: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<{ items: Array<{ offset: number; payload: T }>; nextOffset: number; pagesRead: number }> {
  const items: Array<{ offset: number; payload: T }> = [];
  let offset = 0;
  let pages = 0;

  while (pages < 40) {
    const batch = await readDurableWithPolicy<T>(lane, sessionId, offset, 500);
    if (!batch) {
      return {
        items,
        nextOffset: items.length > 0 ? items[items.length - 1]!.offset + 1 : 0,
        pagesRead: pages,
      };
    }

    let acceptedInBatch = 0;
    for (const item of batch.items) {
      const parsed = parser.safeParse(item.payload);
      if (!parsed.success) {
        recordDroppedInvalidDurablePayload(lane);
        continue;
      }
      items.push({ offset: item.offset, payload: parsed.data });
      acceptedInBatch += 1;
    }

    if (batch.nextOffset <= offset) {
      return { items, nextOffset: Math.max(offset, batch.nextOffset), pagesRead: pages + 1 };
    }

    offset = batch.nextOffset;
    pages += 1;
    if (acceptedInBatch === 0 && batch.items.length === 0) {
      break;
    }
    if (batch.items.length < 500) {
      break;
    }
  }

  return { items, nextOffset: offset, pagesRead: pages };
}

async function hydrateSessionFromDurable(sessionId: string): Promise<StoredSession | null> {
  const startedAtMs = Date.now();
  recordDurableHydrationAttempt();

  try {
    const stateRead = await readDurableLaneFully<StateEvent>('state', sessionId, StateEventSchema);
    const eventRead = await readDurableLaneFully<AiSessionEvent>('events', sessionId, AiSessionEventSchema);
    const presenceRead = await readDurableLaneFully<PresenceEvent>('presence', sessionId, PresenceEventSchema);

    if (stateRead.items.length === 0 && eventRead.items.length === 0 && presenceRead.items.length === 0) {
      recordDurableHydrationMiss(Date.now() - startedAtMs);
      return null;
    }

    let metadata: SessionMetadata | null = null;
    for (const item of stateRead.items) {
      if (item.payload.collection !== 'session') continue;
      if ((item.payload.operation === 'insert' || item.payload.operation === 'update') && item.payload.key === sessionId) {
        metadata = asSessionMetadata(item.payload.value);
        if (metadata) break;
      }
      if (item.payload.operation === 'snapshot-start') {
        const record = asRecord(item.payload.value);
        metadata = asSessionMetadata(record?.metadata ?? record?.session ?? record?.value);
        if (metadata) break;
      }
    }

    const firstTimestamp = stateRead.items[0]?.payload.createdAt
      ?? eventRead.items[0]?.payload.createdAt
      ?? presenceRead.items[0]?.payload.createdAt
      ?? nowIso();

    const hydrated: StoredSession = {
      metadata: ensureHydratedMetadata(
        metadata,
        sessionId,
        metadata?.scope.rootUri ?? `at://session/${sessionId}`,
        metadata?.lookupKey ?? `thread-summary:at://session/${sessionId}`,
        metadata?.createdAt ?? firstTimestamp,
      ),
      members: new Map(),
      eventLane: [],
      stateLane: [],
      presenceLane: [],
      actionDedup: new Set(),
      state: {
        activeGeneration: null,
        artifacts: [],
      },
      nextOffsets: {
        event: eventRead.nextOffset,
        state: stateRead.nextOffset,
        presence: presenceRead.nextOffset,
      },
    };

    for (const item of stateRead.items) {
      pushLaneEvent(hydrated.stateLane, item.offset, item.payload);
      applyStateEventToHydratedSession(hydrated, item.payload);
    }

    for (const item of eventRead.items) {
      pushLaneEvent(hydrated.eventLane, item.offset, item.payload);
    }

    for (const item of presenceRead.items) {
      pushLaneEvent(hydrated.presenceLane, item.offset, item.payload);
    }

    if (hydrated.members.size === 0 && eventRead.items.length > 0) {
      const firstAuthor = eventRead.items.find((item) => item.payload.kind === 'message.user')?.payload;
      if (firstAuthor && firstAuthor.kind === 'message.user') {
        hydrated.members.set(firstAuthor.authorId, {
          did: firstAuthor.authorId,
          role: 'owner',
          joinedAt: firstAuthor.createdAt,
        });
      }
    }

    setOffsetFromLane(hydrated);
    sessionsById.set(sessionId, hydrated);
    lookupToSessionId.set(hydrated.metadata.lookupKey, sessionId);

    recordDurableHydrationSuccess({
      durationMs: Date.now() - startedAtMs,
      replayedItems: {
        events: eventRead.items.length,
        state: stateRead.items.length,
        presence: presenceRead.items.length,
      },
      replayedPages: {
        events: eventRead.pagesRead,
        state: stateRead.pagesRead,
        presence: presenceRead.pagesRead,
      },
    });

    return hydrated;
  } catch (error) {
    recordDurableHydrationFailure(Date.now() - startedAtMs);
    throw error;
  }
}

async function getSessionOrHydrate(sessionId: string): Promise<StoredSession> {
  const cached = sessionsById.get(sessionId);
  if (cached) {
    ensureSessionOffsetsHealthy(cached);
    return cached;
  }

  const hydrated = await hydrateSessionFromDurable(sessionId);
  if (hydrated) {
    ensureSessionOffsetsHealthy(hydrated);
    return hydrated;
  }

  throw new ValidationError('Session not found');
}

export async function resolveThreadSummarySession(rootUri: string, callerDid: string, privacyMode: SessionPrivacyMode): Promise<SessionMetadata> {
  const cleanRootUri = sanitizeText(rootUri, 600);
  if (!cleanRootUri) {
    throw new ValidationError('rootUri is required');
  }

  const lookupKey = normalizeLookupKey(cleanRootUri);
  const existingId = lookupToSessionId.get(lookupKey);
  if (existingId) {
    const existing = sessionsById.get(existingId);
    if (!existing) {
      lookupToSessionId.delete(lookupKey);
    } else {
      if (!existing.members.has(callerDid)) {
        if (existing.metadata.privacyMode === 'private') {
          throw new UnauthorizedError('Private session access denied');
        }
        const joinedAt = nowIso();
        existing.members.set(callerDid, { did: callerDid, role: 'viewer', joinedAt });
        const memberStateEvent: StateEvent = {
          v: 1,
          id: newEventId('state_member_insert'),
          sessionId: existing.metadata.id,
          createdAt: joinedAt,
          collection: 'member',
          operation: 'insert',
          key: callerDid,
          value: { did: callerDid, role: 'viewer', joinedAt },
        };
        await appendStateEvent(existing, memberStateEvent);
      }
      existing.metadata.updatedAt = nowIso();
      return existing.metadata;
    }
  }

  const createdAt = nowIso();
  const id = makeSessionId();

  const metadata: SessionMetadata = {
    id,
    type: 'thread_summary',
    privacyMode,
    scope: { rootUri: cleanRootUri },
    lookupKey,
    createdAt,
    updatedAt: createdAt,
  };

  const owner: Member = {
    did: callerDid,
    role: 'owner',
    joinedAt: createdAt,
  };

  const stored: StoredSession = {
    metadata,
    members: new Map([[callerDid, owner]]),
    eventLane: [],
    stateLane: [],
    presenceLane: [],
    actionDedup: new Set(),
    state: {
      activeGeneration: null,
      artifacts: [],
    },
    nextOffsets: {
      event: 0,
      state: 0,
      presence: 0,
    },
  };

  if (durableLaneConfigured('events')) await ensureDurableStream('events', id);
  if (durableLaneConfigured('state')) await ensureDurableStream('state', id);
  if (durableLaneConfigured('presence')) await ensureDurableStream('presence', id);

  const snapshotStart: StateEvent = {
    v: 1,
    id: newEventId('state_snapshot_start'),
    sessionId: id,
    createdAt,
    collection: 'session',
    operation: 'snapshot-start',
    key: 'session',
    value: { metadata },
  };
  await appendStateEvent(stored, snapshotStart);

  const sessionInsert: StateEvent = {
    v: 1,
    id: newEventId('state_session_insert'),
    sessionId: id,
    createdAt,
    collection: 'session',
    operation: 'insert',
    key: id,
    value: metadata,
  };
  await appendStateEvent(stored, sessionInsert);

  const ownerInsert: StateEvent = {
    v: 1,
    id: newEventId('state_member_insert'),
    sessionId: id,
    createdAt,
    collection: 'member',
    operation: 'insert',
    key: callerDid,
    value: owner,
  };
  await appendStateEvent(stored, ownerInsert);

  const artifactSeed: StateEvent = {
    v: 1,
    id: newEventId('state_artifact_seed'),
    sessionId: id,
    createdAt,
    collection: 'artifact',
    operation: 'insert',
    key: 'current-summary',
    value: null,
  };
  await appendStateEvent(stored, artifactSeed);

  const snapshotEnd: StateEvent = {
    v: 1,
    id: newEventId('state_snapshot_end'),
    sessionId: id,
    createdAt,
    collection: 'session',
    operation: 'snapshot-end',
    key: 'session',
  };
  await appendStateEvent(stored, snapshotEnd);

  sessionsById.set(id, stored);
  lookupToSessionId.set(lookupKey, id);
  return metadata;
}

export function getSessionOrThrow(sessionId: string): StoredSession {
  const session = sessionsById.get(sessionId);
  if (!session) {
    throw new ValidationError('Session not found');
  }
  ensureSessionOffsetsHealthy(session);
  return session;
}

export async function assertSessionAccess(sessionId: string, callerDid: string): Promise<void> {
  const session = await getSessionOrHydrate(sessionId);
  getMemberOrThrow(session, callerDid);
}

export async function bootstrapSession(sessionId: string, callerDid: string) {
  const session = await getSessionOrHydrate(sessionId);
  const member = getMemberOrThrow(session, callerDid);
  const capabilities = roleCapabilities(member.role);

  const messages = session.eventLane
    .map((entry) => entry.payload)
    .filter((event) => event.kind === 'message.user' || event.kind === 'message.assistant');

  const stateSnapshot = {
    session: session.metadata,
    members: Array.from(session.members.values()),
    artifacts: session.state.artifacts,
    activeGeneration: session.state.activeGeneration,
  };

  return {
    session: session.metadata,
    members: Array.from(session.members.values()),
    capabilities,
    messageHistory: messages,
    stateSnapshot,
    eventOffset: session.nextOffsets.event,
    stateOffset: session.nextOffsets.state,
    presenceOffset: session.nextOffsets.presence,
    activeGenerationInProgress: session.state.activeGeneration?.status === 'running',
  };
}

function laneSlice<T>(lane: LaneEnvelope<T>[], offset: number, limit: number): { items: LaneEnvelope<T>[]; nextOffset: number } {
  const safeOffset = Math.max(0, offset);
  const max = Math.max(1, Math.min(limit, 500));
  const items = lane
    .filter((entry) => entry.offset >= safeOffset)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, max);
  const nextOffset = items.length > 0 ? items[items.length - 1]!.offset + 1 : safeOffset;
  return { items, nextOffset };
}

export async function readEventLane(sessionId: string, callerDid: string, offset: number, limit: number) {
  const session = await getSessionOrHydrate(sessionId);
  getMemberOrThrow(session, callerDid);
  const durable = await readDurableWithPolicy<AiSessionEvent>('events', sessionId, offset, limit);
  if (durable) {
    const items: Array<{ offset: number; payload: AiSessionEvent }> = [];
    for (const item of durable.items) {
      const parsed = AiSessionEventSchema.safeParse(item.payload);
      if (!parsed.success) {
        recordDroppedInvalidDurablePayload('events');
        continue;
      }
      if (!laneHasOffset(session.eventLane, item.offset)) {
        pushLaneEvent(session.eventLane, item.offset, parsed.data);
      }
      items.push({ offset: item.offset, payload: parsed.data });
    }
    session.nextOffsets.event = Math.max(session.nextOffsets.event, durable.nextOffset);
    trimLane(session.eventLane);
    return {
      items,
      nextOffset: durable.nextOffset,
    };
  }
  return laneSlice(session.eventLane, offset, limit);
}

export async function readStateLane(sessionId: string, callerDid: string, offset: number, limit: number) {
  const session = await getSessionOrHydrate(sessionId);
  getMemberOrThrow(session, callerDid);
  const durable = await readDurableWithPolicy<StateEvent>('state', sessionId, offset, limit);
  if (durable) {
    const items: Array<{ offset: number; payload: StateEvent }> = [];
    for (const item of durable.items) {
      const parsed = StateEventSchema.safeParse(item.payload);
      if (!parsed.success) {
        recordDroppedInvalidDurablePayload('state');
        continue;
      }
      if (!laneHasOffset(session.stateLane, item.offset)) {
        pushLaneEvent(session.stateLane, item.offset, parsed.data);
      }
      items.push({ offset: item.offset, payload: parsed.data });
    }
    session.nextOffsets.state = Math.max(session.nextOffsets.state, durable.nextOffset);
    trimLane(session.stateLane);
    return {
      items,
      nextOffset: durable.nextOffset,
    };
  }
  return laneSlice(session.stateLane, offset, limit);
}

export async function readPresenceLane(sessionId: string, callerDid: string, offset: number, limit: number) {
  const session = await getSessionOrHydrate(sessionId);
  getMemberOrThrow(session, callerDid);
  const durable = await readDurableWithPolicy<PresenceEvent>('presence', sessionId, offset, limit);
  if (durable) {
    const items: Array<{ offset: number; payload: PresenceEvent }> = [];
    for (const item of durable.items) {
      const parsed = PresenceEventSchema.safeParse(item.payload);
      if (!parsed.success) {
        recordDroppedInvalidDurablePayload('presence');
        continue;
      }
      if (!laneHasOffset(session.presenceLane, item.offset)) {
        pushLaneEvent(session.presenceLane, item.offset, parsed.data);
      }
      items.push({ offset: item.offset, payload: parsed.data });
    }
    session.nextOffsets.presence = Math.max(session.nextOffsets.presence, durable.nextOffset);
    trimLane(session.presenceLane);
    return {
      items,
      nextOffset: durable.nextOffset,
    };
  }
  return laneSlice(session.presenceLane, offset, limit);
}

function deterministicAssistantSummary(content: string): string {
  const normalized = sanitizeText(content, 1800);
  if (!normalized) {
    return 'No content available to summarize.';
  }
  return `Draft thread summary: ${normalized.slice(0, 300)}${normalized.length > 300 ? '...' : ''}`;
}

export async function writeSessionMessage(
  sessionId: string,
  callerDid: string,
  payload: {
    clientActionId: string;
    kind: 'message' | 'regenerate' | 'ask_followup' | 'revise_summary' | 'critique' | 'tool_action';
    content: string;
    targetArtifactId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const session = await getSessionOrHydrate(sessionId);
  const member = getMemberOrThrow(session, callerDid);
  const capabilities = roleCapabilities(member.role);
  if (!capabilities.canWriteMessages) {
    throw new UnauthorizedError('You are not allowed to write messages in this session');
  }

  const idempotencyKey = `${sessionId}:${callerDid}:${payload.clientActionId}`;
  if (session.actionDedup.has(idempotencyKey)) {
    return {
      deduplicated: true,
      accepted: true,
      activeGeneration: session.state.activeGeneration,
    };
  }

  const hasRunningGeneration = session.state.activeGeneration?.status === 'running';
  if (hasRunningGeneration && capabilities.canTriggerGeneration) {
    throw new ValidationError('A generation is already running for this session branch');
  }

  const now = nowIso();
  const cleanContent = sanitizeText(payload.content, 6000);
  if (!cleanContent) {
    throw new ValidationError('content is required');
  }
  await assertNoUnsafeUrlsInMessageContent(cleanContent);

  pushActionDedup(session, idempotencyKey);

  const userMessage: AiSessionEvent = {
    v: 1,
    kind: 'message.user',
    id: newEventId('evt_user_msg'),
    sessionId,
    authorId: callerDid,
    text: cleanContent,
    createdAt: now,
  };
  await appendEvent(session, userMessage);

  const runId = newEventId('run');
  session.state.activeGeneration = {
    runId,
    startedAt: now,
    status: 'running',
    branchId: 'main',
  };

  const running: AiSessionEvent = {
    v: 1,
    kind: 'generation.status',
    id: newEventId('evt_gen_status'),
    sessionId,
    status: 'running',
    createdAt: now,
  };
  await appendEvent(session, running);

  const toolRunState: StateEvent = {
    v: 1,
    id: newEventId('state_tool_run'),
    sessionId,
    createdAt: now,
    collection: 'toolRun',
    operation: 'update',
    key: runId,
    value: {
      runId,
      status: 'running',
      kind: payload.kind,
      ...(payload.targetArtifactId ? { targetArtifactId: sanitizeArtifactId(payload.targetArtifactId) } : {}),
      ...(payload.metadata
        ? {
            metadata: (() => {
              const sanitized = sanitizeUnknownJson(payload.metadata);
              try {
                if (JSON.stringify(sanitized) !== JSON.stringify(payload.metadata)) {
                  recordMetadataSanitizationMutation();
                }
              } catch {
                recordMetadataSanitizationMutation();
              }
              return sanitized;
            })(),
          }
        : {}),
    },
  };
  await appendStateEvent(session, toolRunState);

  const assistantText = deterministicAssistantSummary(cleanContent);
  const assistantMessageId = newEventId('evt_assistant_msg');

  const tokenChunks = assistantText.match(/.{1,80}/g) ?? [assistantText];
  for (const chunk of tokenChunks) {
    const tokenEvent: AiSessionEvent = {
      v: 1,
      kind: 'token.delta',
      id: newEventId('evt_token'),
      sessionId,
      messageId: assistantMessageId,
      delta: chunk,
      createdAt: nowIso(),
    };
    await appendEvent(session, tokenEvent);
  }

  const assistantMessage: AiSessionEvent = {
    v: 1,
    kind: 'message.assistant',
    id: assistantMessageId,
    sessionId,
    text: assistantText,
    createdAt: nowIso(),
    final: true,
  };
  await appendEvent(session, assistantMessage);

  const artifactId = sanitizeArtifactId(payload.targetArtifactId);
  const artifact = {
    id: artifactId,
    kind: 'threadSummary' as const,
    content: assistantText,
    updatedAt: nowIso(),
    status: 'ready' as const,
  };

  const artifactIndex = session.state.artifacts.findIndex((item) => item.id === artifactId);
  if (artifactIndex >= 0) {
    session.state.artifacts[artifactIndex] = artifact;
  } else {
    session.state.artifacts.push(artifact);
  }

  const artifactUpdate: StateEvent = {
    v: 1,
    id: newEventId('state_artifact_update'),
    sessionId,
    createdAt: nowIso(),
    collection: 'artifact',
    operation: 'update',
    key: artifactId,
    value: artifact,
  };
  await appendStateEvent(session, artifactUpdate);

  session.state.activeGeneration = session.state.activeGeneration
    ? {
        ...session.state.activeGeneration,
        status: 'completed',
      }
    : null;

  const completed: AiSessionEvent = {
    v: 1,
    kind: 'generation.status',
    id: newEventId('evt_gen_status'),
    sessionId,
    status: 'completed',
    createdAt: nowIso(),
  };
  await appendEvent(session, completed);

  const toolRunDone: StateEvent = {
    v: 1,
    id: newEventId('state_tool_run_done'),
    sessionId,
    createdAt: nowIso(),
    collection: 'toolRun',
    operation: 'update',
    key: runId,
    value: {
      runId,
      status: 'completed',
    },
  };
  await appendStateEvent(session, toolRunDone);

  session.metadata.updatedAt = nowIso();

  return {
    deduplicated: false,
    accepted: true,
    activeGeneration: session.state.activeGeneration,
  };
}

export async function writePresence(sessionId: string, callerDid: string, isTyping: boolean, expiresInMs: number) {
  const session = await getSessionOrHydrate(sessionId);
  const member = getMemberOrThrow(session, callerDid);
  const capabilities = roleCapabilities(member.role);
  if (!capabilities.canWritePresence) {
    throw new UnauthorizedError('You are not allowed to write presence in this session');
  }

  const now = Date.now();
  const expiresAt = new Date(now + expiresInMs).toISOString();
  const event: PresenceEvent = {
    v: 1,
    id: newEventId('presence'),
    sessionId,
    createdAt: new Date(now).toISOString(),
    userId: callerDid,
    isTyping,
    expiresAt,
  };
  await appendPresence(session, event);
  session.metadata.updatedAt = new Date(now).toISOString();
  return event;
}
