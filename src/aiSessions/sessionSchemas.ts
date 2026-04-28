import { z } from 'zod';

export const AiSessionIdSchema = z.string().min(12).max(128).regex(/^as_[a-zA-Z0-9_-]+$/);
export const DidSchema = z.string().min(7).max(190).regex(/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/);

export const SessionCapabilitiesSchema = z.object({
  canWriteMessages: z.boolean(),
  canTriggerGeneration: z.boolean(),
  canInvite: z.boolean(),
  canViewArtifacts: z.boolean(),
  canWritePresence: z.boolean(),
});

export const SessionMetadataSchema = z.object({
  id: AiSessionIdSchema,
  type: z.enum(['thread_summary']),
  privacyMode: z.enum(['private', 'shared', 'room']),
  scope: z.object({
    rootUri: z.string().min(1).max(600),
  }),
  lookupKey: z.string().min(1).max(800),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MemberSchema = z.object({
  did: DidSchema,
  role: z.enum(['owner', 'editor', 'viewer', 'agent']),
  joinedAt: z.string(),
});

export const AiSessionEventSchema = z.discriminatedUnion('kind', [
  z.object({
    v: z.literal(1),
    kind: z.literal('message.user'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    authorId: DidSchema,
    text: z.string(),
    createdAt: z.string(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('message.assistant'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    text: z.string(),
    createdAt: z.string(),
    final: z.boolean(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('token.delta'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    messageId: z.string(),
    delta: z.string(),
    createdAt: z.string(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('tool.started'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    toolRunId: z.string(),
    name: z.string(),
    createdAt: z.string(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('tool.result'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    toolRunId: z.string(),
    result: z.unknown(),
    createdAt: z.string(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('generation.status'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    status: z.enum(['running', 'completed', 'cancelled', 'failed']),
    createdAt: z.string(),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('generation.error'),
    id: z.string(),
    sessionId: AiSessionIdSchema,
    code: z.string(),
    message: z.string(),
    createdAt: z.string(),
  }),
]);

export const StateEventSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  sessionId: AiSessionIdSchema,
  createdAt: z.string(),
  collection: z.enum(['session', 'member', 'artifact', 'toolRun', 'checkpoint']),
  operation: z.enum(['insert', 'update', 'delete', 'snapshot-start', 'snapshot-end', 'reset']),
  key: z.string(),
  value: z.unknown().optional(),
});

export const PresenceEventSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  sessionId: AiSessionIdSchema,
  createdAt: z.string(),
  userId: DidSchema,
  isTyping: z.boolean(),
  expiresAt: z.string(),
});

export const LaneEnvelopeSchema = <T extends z.ZodTypeAny>(schema: T) => z.object({
  offset: z.number().int().nonnegative(),
  payload: schema,
});

export const BootstrapResponseSchema = z.object({
  session: SessionMetadataSchema,
  members: z.array(MemberSchema),
  capabilities: SessionCapabilitiesSchema,
  messageHistory: z.array(AiSessionEventSchema),
  stateSnapshot: z.object({
    session: SessionMetadataSchema,
    members: z.array(MemberSchema),
    artifacts: z.array(z.unknown()),
    activeGeneration: z.unknown().nullable(),
  }),
  eventOffset: z.number().int().nonnegative(),
  stateOffset: z.number().int().nonnegative(),
  presenceOffset: z.number().int().nonnegative(),
  activeGenerationInProgress: z.boolean(),
});

export const ResolveSessionResponseSchema = z.object({
  sessionId: AiSessionIdSchema,
  session: SessionMetadataSchema,
});

export const LaneReadResponseSchema = <T extends z.ZodTypeAny>(schema: T) => z.object({
  sessionId: AiSessionIdSchema,
  lane: z.enum(['events', 'state', 'presence']),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative(),
  items: z.array(LaneEnvelopeSchema(schema)),
  live: z.boolean(),
});

export type AiSessionId = z.infer<typeof AiSessionIdSchema>;
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;
export type SessionCapabilities = z.infer<typeof SessionCapabilitiesSchema>;
export type SessionMember = z.infer<typeof MemberSchema>;
export type AiSessionEvent = z.infer<typeof AiSessionEventSchema>;
export type StateEvent = z.infer<typeof StateEventSchema>;
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;
