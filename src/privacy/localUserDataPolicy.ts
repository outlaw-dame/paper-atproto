import { LOCAL_PERSONALIZATION_STORAGE_KEY } from '../intelligence/ranking/localPersonalization';

export type LocalUserDataCategory =
  | 'content_history'
  | 'local_personalization'
  | 'local_preference'
  | 'ui_resume'
  | 'diagnostic_history';

export type LocalUserDataStorageScope =
  | 'browser-local'
  | 'browser-session'
  | 'browser-indexeddb'
  | 'memory';

export interface LocalUserDataSurface {
  id: string;
  category: LocalUserDataCategory;
  storageKey: string;
  storageScope: LocalUserDataStorageScope;
  remoteSync: 'forbidden';
  resettable: boolean;
  bounded: boolean;
  retention:
    | 'session'
    | 'until-user-reset'
    | 'ttl'
    | 'bounded-history';
  containsRawContent: boolean;
  containsProtocolIdentifiers: boolean;
  notes: string;
}

export interface LocalUserDataPolicyReport {
  valid: boolean;
  surfaceCount: number;
  failures: string[];
  surfaces: LocalUserDataSurface[];
}

const LOCAL_ONLY_SCOPES = new Set<LocalUserDataStorageScope>([
  'browser-local',
  'browser-session',
  'browser-indexeddb',
  'memory',
]);

export const REMOTE_USER_DATA_SYNC_ALLOWED = false as const;

export const LOCAL_USER_DATA_SURFACES: LocalUserDataSurface[] = [
  {
    id: 'ranking.local-personalization',
    category: 'local_personalization',
    storageKey: LOCAL_PERSONALIZATION_STORAGE_KEY,
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'until-user-reset',
    containsRawContent: false,
    containsProtocolIdentifiers: false,
    notes: 'Stores only local depth/breadth/recency preference weights and control metadata.',
  },
  {
    id: 'store.interpolator-settings',
    category: 'local_preference',
    storageKey: 'glympse.interpolator-settings.v2',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'until-user-reset',
    containsRawContent: false,
    containsProtocolIdentifiers: false,
    notes: 'Stores local Interpolator UI/debug preference toggles only.',
  },
  {
    id: 'store.ui-resume',
    category: 'ui_resume',
    storageKey: 'glympse.ui.state.v1',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'until-user-reset',
    containsRawContent: false,
    containsProtocolIdentifiers: true,
    notes: 'Stores bounded app resume state such as active tab, feed mode, sanitized profile target, and queries.',
  },
  {
    id: 'store.feed-cache',
    category: 'content_history',
    storageKey: 'feed-cache',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'ttl',
    containsRawContent: true,
    containsProtocolIdentifiers: true,
    notes: 'Stores bounded feed cache and reading position locally with pruning and TTL behavior.',
  },
  {
    id: 'ai-sessions.session-cache',
    category: 'content_history',
    storageKey: 'paper-ai-session-cache-v1',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'ttl',
    containsRawContent: false,
    containsProtocolIdentifiers: true,
    notes: 'Stores bounded AI-session resume metadata locally; minimal persistence drops message history by default.',
  },
  {
    id: 'perf.conversation-os-health-history',
    category: 'diagnostic_history',
    storageKey: 'glympse:conversation-os-health-history:v1',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'bounded-history',
    containsRawContent: false,
    containsProtocolIdentifiers: false,
    notes: 'Stores sanitized local health trend snapshots for diagnostics.',
  },
  {
    id: 'perf.writer-enhancer-provider-history',
    category: 'diagnostic_history',
    storageKey: 'glympse:writer-enhancer-provider-history:v1',
    storageScope: 'browser-local',
    remoteSync: 'forbidden',
    resettable: true,
    bounded: true,
    retention: 'bounded-history',
    containsRawContent: false,
    containsProtocolIdentifiers: false,
    notes: 'Stores sanitized provider-quality trend snapshots for local diagnostics.',
  },
];

export function validateLocalUserDataPolicy(
  surfaces: LocalUserDataSurface[] = LOCAL_USER_DATA_SURFACES,
): LocalUserDataPolicyReport {
  const failures: string[] = [];
  const seenKeys = new Set<string>();

  for (const surface of surfaces) {
    if (!surface.id.trim()) failures.push('surface_missing_id');
    if (!surface.storageKey.trim()) failures.push(`${surface.id}:missing_storage_key`);
    if (seenKeys.has(surface.storageKey)) failures.push(`${surface.id}:duplicate_storage_key`);
    seenKeys.add(surface.storageKey);
    if (!LOCAL_ONLY_SCOPES.has(surface.storageScope)) failures.push(`${surface.id}:non_local_storage_scope`);
    if (surface.remoteSync !== 'forbidden') failures.push(`${surface.id}:remote_sync_not_forbidden`);
    if (!surface.resettable) failures.push(`${surface.id}:not_resettable`);
    if (!surface.bounded) failures.push(`${surface.id}:not_bounded`);
    if (surface.category === 'local_personalization' && surface.containsRawContent) {
      failures.push(`${surface.id}:personalization_contains_raw_content`);
    }
    if (surface.category === 'local_personalization' && surface.containsProtocolIdentifiers) {
      failures.push(`${surface.id}:personalization_contains_protocol_identifiers`);
    }
    if (surface.category === 'local_preference' && surface.containsRawContent) {
      failures.push(`${surface.id}:preference_contains_raw_content`);
    }
  }

  return {
    valid: failures.length === 0,
    surfaceCount: surfaces.length,
    failures,
    surfaces,
  };
}

export function summarizeLocalUserDataPolicy(
  surfaces: LocalUserDataSurface[] = LOCAL_USER_DATA_SURFACES,
): Record<LocalUserDataCategory, number> {
  return surfaces.reduce<Record<LocalUserDataCategory, number>>((acc, surface) => {
    acc[surface.category] += 1;
    return acc;
  }, {
    content_history: 0,
    local_personalization: 0,
    local_preference: 0,
    ui_resume: 0,
    diagnostic_history: 0,
  });
}
