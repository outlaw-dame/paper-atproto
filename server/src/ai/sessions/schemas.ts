import { z } from 'zod';

export const SESSION_EVENT_VERSION = 1 as const;

const SessionIdSchema = z.string().min(12).max(128).regex(/^as_[a-zA-Z0-9_-]+$/);
const DidSchema = z.string().min(7).max(190).regex(/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/);
const IsoDateSchema = z.string().datetime();

export const SessionTypeSchema = z.enum(['thread_summary']);
export const SessionPrivacyModeSchema = z.enum(['private', 'shared', 'room']);
export const SessionRoleSchema = z.enum(['owner', 'editor', 'viewer', 'agent']);

export type SessionType = z.infer<typeof SessionTypeSchema>;
export type SessionPrivacyMode = z.infer<typeof SessionPrivacyModeSchema>;
export type SessionRole = z.infer<typeof SessionRoleSchema>;

export const SessionCapabilitiesSchema = z.object({
  canWriteMessages: z.boolean(),
  canTriggerGeneration: z.boolean(),
  canInvite: z.boolean(),
  canViewArtifacts: z.boolean(),
  canWritePresence: z.boolean(),
});

export const SessionMetadataSchema = z.object({
  id: SessionIdSchema,
  type: SessionTypeSchema,
  privacyMode: SessionPrivacyModeSchema,
  scope: z.object({
    rootUri: z.string().min(1).max(600),
  }),
  lookupKey: z.string().min(1).max(800),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const MemberSchema = z.object({
  did: DidSchema,
  role: SessionRoleSchema,
  joinedAt: IsoDateSchema,
});

export type Member = z.infer<typeof MemberSchema>;

const BaseEventSchema = z.object({
  v: z.literal(SESSION_EVENT_VERSION),
  id: z.string().min(12).max(128),
  sessionId: SessionIdSchema,
  createdAt: IsoDateSchema,
});

export const AiSessionEventSchema = z.discriminatedUnion('kind', [
  BaseEventSchema.extend({
    kind: z.literal('message.user'),
    authorId: DidSchema,
    text: z.string().min(1).max(6000),
  }),
  BaseEventSchema.extend({
    kind: z.literal('message.assistant'),
    text: z.string().min(1).max(12000),
    final: z.boolean(),
  }),
  BaseEventSchema.extend({
    kind: z.literal('token.delta'),
    messageId: z.string().min(12).max(128),
    delta: z.string().min(1).max(1024),
  }),
  BaseEventSchema.extend({
    kind: z.literal('tool.started'),
    toolRunId: z.string().min(12).max(128),
    name: z.string().min(1).max(120),
  }),
  BaseEventSchema.extend({
    kind: z.literal('tool.result'),
    toolRunId: z.string().min(12).max(128),
    result: z.unknown(),
  }),
  BaseEventSchema.extend({
    kind: z.literal('generation.status'),
    status: z.enum(['running', 'completed', 'cancelled', 'failed']),
  }),
  BaseEventSchema.extend({
    kind: z.literal('generation.error'),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
  }),
]);

export type AiSessionEvent = z.infer<typeof AiSessionEventSchema>;

export const StateCollectionSchema = z.enum(['session', 'member', 'artifact', 'toolRun', 'checkpoint']);
export const StateOperationSchema = z.enum(['insert', 'update', 'delete', 'snapshot-start', 'snapshot-end', 'reset']);

export const StateEventSchema = z.object({
  v: z.literal(SESSION_EVENT_VERSION),
  id: z.string().min(12).max(128),
  sessionId: SessionIdSchema,
  createdAt: IsoDateSchema,
  collection: StateCollectionSchema,
  operation: StateOperationSchema,
  key: z.string().min(1).max(256),
  value: z.unknown().optional(),
});

export type StateEvent = z.infer<typeof StateEventSchema>;

export const PresenceEventSchema = z.object({
  v: z.literal(SESSION_EVENT_VERSION),
  id: z.string().min(12).max(128),
  sessionId: SessionIdSchema,
  createdAt: IsoDateSchema,
  userId: DidSchema,
  isTyping: z.boolean(),
  expiresAt: IsoDateSchema,
});

export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

export const MessageActionKindSchema = z.enum([
  'message',
  'regenerate',
  'ask_followup',
  'revise_summary',
  'critique',
  'tool_action',
]);

export const SendMessageRequestSchema = z.object({
  clientActionId: z.string().min(12).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  kind: MessageActionKindSchema,
  content: z.string().min(1).max(6000),
  targetArtifactId: z.string().min(1).max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const ResolveThreadSummarySessionRequestSchema = z.object({
  rootUri: z.string().min(1).max(600),
  privacyMode: SessionPrivacyModeSchema.default('private'),
});

export type ResolveThreadSummarySessionRequest = z.infer<typeof ResolveThreadSummarySessionRequestSchema>;

export const PresenceWriteRequestSchema = z.object({
  isTyping: z.boolean(),
  expiresInMs: z.number().int().min(1000).max(10_000).default(6000),
});

export type PresenceWriteRequest = z.infer<typeof PresenceWriteRequestSchema>;

export function roleCapabilities(role: SessionRole) {
  switch (role) {
    case 'owner':
      return {
        canWriteMessages: true,
        canTriggerGeneration: true,
        canInvite: true,
        canViewArtifacts: true,
        canWritePresence: true,
      };
    case 'editor':
      return {
        canWriteMessages: true,
        canTriggerGeneration: true,
        canInvite: false,
        canViewArtifacts: true,
        canWritePresence: true,
      };
    case 'agent':
      return {
        canWriteMessages: true,
        canTriggerGeneration: true,
        canInvite: false,
        canViewArtifacts: true,
        canWritePresence: false,
      };
    case 'viewer':
    default:
      return {
        canWriteMessages: false,
        canTriggerGeneration: false,
        canInvite: false,
        canViewArtifacts: true,
        canWritePresence: false,
      };
  }
}
