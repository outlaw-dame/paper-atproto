/**
 * SessionBrief — the canonical, normalized snapshot the coordinator
 * facade hands to every downstream router/planner/writer for a single
 * coordinator tick.
 *
 * It exists so the same fields aren't recomputed (or, worse, recomputed
 * inconsistently) at five different call sites. Every field has a safe
 * default and the builder is total: bad/partial input returns a brief
 * the registry can still reason about.
 *
 * Privacy & safety:
 *   • `sourceToken` and `sessionId` are passed through as opaque short
 *     strings; we never embed user text.
 *   • `attachments` is just a count + flags. The facade never stores the
 *     attachment payloads.
 */
import type { RuntimeCapability } from '../../runtime/capabilityProbe';
import type { RuntimeMode } from '../../runtime/modelPolicy';
import type {
  DataScope,
  DeviceTier,
  IntelligenceTask,
  PrivacyMode,
} from '../intelligenceRoutingPolicy';
import type { PremiumAiEntitlements } from '../premiumContracts';

export const SESSION_BRIEF_SCHEMA_VERSION = 1 as const;

export interface SessionBriefAttachments {
  count: number;
  hasImages: boolean;
  hasLinks: boolean;
  hasCode: boolean;
}

export interface SessionBriefRuntimeHealth {
  batterySaver: boolean;
  thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
  sustainedLatencyMs: number | null;
  storageAvailableGiB: number | null;
}

export interface SessionBriefFreshness {
  /** ISO timestamp of the last upstream mutation we know about. */
  lastMutationAt: string | null;
  /** Opaque token capturing source state — used to reject stale outputs. */
  sourceToken: string | null;
}

export interface SessionBriefInput {
  surface: string;
  intent: IntelligenceTask;
  scope?: DataScope;
  privacy?: PrivacyMode;
  capability?: RuntimeCapability;
  settingsMode?: RuntimeMode;
  deviceTier?: DeviceTier;
  freshness?: Partial<SessionBriefFreshness>;
  sessionId?: string;
  attachments?: Partial<SessionBriefAttachments>;
  entitlements?: PremiumAiEntitlements | null;
  runtimeHealth?: Partial<SessionBriefRuntimeHealth>;
  explicitUserAction?: boolean;
  /** Approximate text length the surface is operating on (for input stats). */
  textLength?: number;
  /** Approximate prompt token estimate when known. */
  estimatedPromptTokens?: number;
  /** True when the surface is operating on data the user has not consented to send remotely. */
  hasSensitiveLocalData?: boolean;
  /** Optional override for the brief's `at` timestamp (for tests). */
  nowIso?: string;
}

export interface SessionBrief {
  schemaVersion: typeof SESSION_BRIEF_SCHEMA_VERSION;
  at: string;
  surface: string;
  intent: IntelligenceTask;
  scope: DataScope;
  privacy: PrivacyMode;
  deviceTier: DeviceTier;
  settingsMode: RuntimeMode;
  capability: RuntimeCapability | null;
  freshness: SessionBriefFreshness;
  sessionId: string | null;
  attachments: SessionBriefAttachments;
  entitlements: PremiumAiEntitlements | null;
  runtimeHealth: SessionBriefRuntimeHealth;
  explicitUserAction: boolean;
  textLength: number;
  estimatedPromptTokens: number;
  hasSensitiveLocalData: boolean;
}

const DEFAULT_PRIVACY: PrivacyMode = 'balanced';
const DEFAULT_SETTINGS_MODE: RuntimeMode = 'balanced';

const DEFAULT_RUNTIME_HEALTH: SessionBriefRuntimeHealth = Object.freeze({
  batterySaver: false,
  thermalState: 'nominal',
  sustainedLatencyMs: null,
  storageAvailableGiB: null,
});

const DEFAULT_ATTACHMENTS: SessionBriefAttachments = Object.freeze({
  count: 0,
  hasImages: false,
  hasLinks: false,
  hasCode: false,
});

function defaultDataScopeFor(intent: IntelligenceTask): DataScope {
  switch (intent) {
    case 'composer_instant':
    case 'composer_refine':
    case 'composer_writer':
      return 'private_draft';
    case 'local_search':
      return 'local_cache';
    case 'public_search':
    case 'story_summary':
      return 'public_corpus';
    case 'media_analysis':
      return 'private_corpus';
    default:
      return 'public_corpus';
  }
}

function deriveDeviceTier(
  explicit: DeviceTier | undefined,
  capability: RuntimeCapability | undefined,
): DeviceTier {
  if (explicit === 'low' || explicit === 'mid' || explicit === 'high') return explicit;
  switch (capability?.tier) {
    case 'high':
      return 'high';
    case 'mid':
      return 'mid';
    case 'low':
      return 'low';
    default:
      return 'mid';
  }
}

function safeNonNegInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function safeBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function safeIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 40 ? trimmed : null;
}

function safeShortToken(value: unknown, max = 64): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
  return cleaned.length > 0 ? cleaned : null;
}

function safeNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function safeThermalState(
  value: unknown,
): SessionBriefRuntimeHealth['thermalState'] {
  if (value === 'fair' || value === 'serious' || value === 'critical') return value;
  return 'nominal';
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '1970-01-01T00:00:00.000Z';
  }
}

/**
 * Build a normalized {@link SessionBrief}. Total — bad/partial input
 * always produces a usable brief with safe defaults.
 */
export function buildSessionBrief(input: SessionBriefInput): SessionBrief {
  const scope = input.scope ?? defaultDataScopeFor(input.intent);
  const privacy = input.privacy ?? DEFAULT_PRIVACY;
  const settingsMode = input.settingsMode ?? DEFAULT_SETTINGS_MODE;
  const capability = input.capability ?? null;
  const deviceTier = deriveDeviceTier(input.deviceTier, input.capability);

  const attachmentsInput = input.attachments ?? {};
  const attachments: SessionBriefAttachments = Object.freeze({
    count: safeNonNegInt(attachmentsInput.count, 0),
    hasImages: safeBool(attachmentsInput.hasImages, false),
    hasLinks: safeBool(attachmentsInput.hasLinks, false),
    hasCode: safeBool(attachmentsInput.hasCode, false),
  });

  const freshnessInput = input.freshness ?? {};
  const freshness: SessionBriefFreshness = Object.freeze({
    lastMutationAt: safeIsoOrNull(freshnessInput.lastMutationAt),
    sourceToken: safeShortToken(freshnessInput.sourceToken),
  });

  const runtimeHealthInput = input.runtimeHealth ?? {};
  const runtimeHealth: SessionBriefRuntimeHealth = Object.freeze({
    batterySaver: safeBool(runtimeHealthInput.batterySaver, DEFAULT_RUNTIME_HEALTH.batterySaver),
    thermalState: safeThermalState(runtimeHealthInput.thermalState),
    sustainedLatencyMs: safeNumberOrNull(runtimeHealthInput.sustainedLatencyMs),
    storageAvailableGiB: safeNumberOrNull(runtimeHealthInput.storageAvailableGiB),
  });

  const brief: SessionBrief = {
    schemaVersion: SESSION_BRIEF_SCHEMA_VERSION,
    at: input.nowIso ?? nowIso(),
    surface: input.surface,
    intent: input.intent,
    scope,
    privacy,
    deviceTier,
    settingsMode,
    capability,
    freshness,
    sessionId: safeShortToken(input.sessionId),
    attachments,
    entitlements: input.entitlements ?? null,
    runtimeHealth,
    explicitUserAction: safeBool(input.explicitUserAction, false),
    textLength: safeNonNegInt(input.textLength, 0),
    estimatedPromptTokens: safeNonNegInt(input.estimatedPromptTokens, 0),
    hasSensitiveLocalData: safeBool(input.hasSensitiveLocalData, false),
  };

  return Object.freeze(brief);
}

/** Returns a shallow brief whose attachments / freshness have been replaced. */
export function withFreshness(
  brief: SessionBrief,
  freshness: Partial<SessionBriefFreshness>,
): SessionBrief {
  return Object.freeze({
    ...brief,
    freshness: Object.freeze({
      lastMutationAt: safeIsoOrNull(freshness.lastMutationAt ?? brief.freshness.lastMutationAt),
      sourceToken: safeShortToken(freshness.sourceToken ?? brief.freshness.sourceToken),
    }),
  });
}
