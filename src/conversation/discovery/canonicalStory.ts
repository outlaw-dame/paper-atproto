import type { StoryCluster } from './storyClustering';

export type StoryProtocol = 'atproto' | 'activitypub' | 'unknown';

export interface CanonicalStorySignals {
  externalUrls: string[];
  entityIds: string[];
  quotedUris: string[];
  rootUris: string[];
}

export interface CanonicalStoryIdentity {
  schemaVersion: 1;
  id: string;
  rootSignals: CanonicalStorySignals;
  sourceThreads: string[];
  protocols: StoryProtocol[];
  confidence: number;
}

export function canonicalStoryIdentityFromCluster(
  cluster: StoryCluster,
): CanonicalStoryIdentity {
  const rootSignals: CanonicalStorySignals = {
    externalUrls: normalizeList(cluster.externalUrls),
    entityIds: normalizeList(cluster.entityIds),
    quotedUris: normalizeList(cluster.quotedUris),
    rootUris: normalizeList(cluster.rootUris),
  };
  const sourceThreads = normalizeList(cluster.postUris);

  return {
    schemaVersion: 1,
    id: generateCanonicalStoryId(rootSignals, sourceThreads),
    rootSignals,
    sourceThreads,
    protocols: deriveProtocols(sourceThreads),
    confidence: clamp01(cluster.confidence),
  };
}

export function canonicalStoryIdentitiesFromClusters(
  clusters: StoryCluster[],
): CanonicalStoryIdentity[] {
  return clusters.map(canonicalStoryIdentityFromCluster);
}

export function detectStoryProtocol(uri: string): StoryProtocol {
  if (uri.startsWith('at://')) return 'atproto';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return 'activitypub';
  return 'unknown';
}

export function generateCanonicalStoryId(
  signals: CanonicalStorySignals,
  sourceThreads: string[] = [],
): string {
  const canonicalKey = JSON.stringify({
    urls: normalizeList(signals.externalUrls),
    entities: normalizeList(signals.entityIds),
    quotes: normalizeList(signals.quotedUris),
    roots: normalizeList(signals.rootUris),
    fallbackThreads: hasRootSignals(signals) ? [] : normalizeList(sourceThreads),
  });

  return `story:${hashString(canonicalKey)}`;
}

function deriveProtocols(sourceThreads: string[]): StoryProtocol[] {
  const protocols = new Set<StoryProtocol>();
  for (const uri of sourceThreads) {
    protocols.add(detectStoryProtocol(uri));
  }
  return [...protocols].sort();
}

function hasRootSignals(signals: CanonicalStorySignals): boolean {
  return signals.externalUrls.length > 0
    || signals.entityIds.length > 0
    || signals.quotedUris.length > 0
    || signals.rootUris.length > 0;
}

function normalizeList(values: string[]): string[] {
  return [...new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  )].sort();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
