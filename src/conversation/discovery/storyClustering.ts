import type { MockPost } from '../../data/mockData';

export interface StoryCluster {
  id: string;
  rootUris: string[];
  quotedUris: string[];
  externalUrls: string[];
  entityIds: string[];
  domains: string[];
  postUris: string[];
  confidence: number;
}

export interface StoryClusterInputPost {
  uri: string;
  cid?: string;
  threadRootUri?: string;
  quotedPostUri?: string;
  externalUrls?: string[];
  domains?: string[];
  canonicalEntityIds?: string[];
  authorDid?: string;
}

interface ClusterSignals {
  roots: Set<string>;
  quotes: Set<string>;
  links: Set<string>;
  entities: Set<string>;
  domains: Set<string>;
}

export function buildStoryClusters(posts: StoryClusterInputPost[]): StoryCluster[] {
  if (posts.length === 0) return [];

  const parents = posts.map((_, index) => index);
  const signals = posts.map(extractSignals);

  for (let left = 0; left < posts.length; left += 1) {
    for (let right = left + 1; right < posts.length; right += 1) {
      if (sharesStrongSignal(signals[left]!, signals[right]!)) {
        union(parents, left, right);
      }
    }
  }

  const groups = new Map<number, number[]>();
  posts.forEach((_, index) => {
    const root = find(parents, index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });

  return [...groups.values()].map((indexes) => buildCluster(posts, signals, indexes));
}

export function storyClusterInputFromMockPost(post: MockPost): StoryClusterInputPost {
  const externalUrls = new Set<string>();
  const domains = new Set<string>();
  let quotedPostUri: string | undefined;

  for (const facet of post.facets ?? []) {
    if (facet.kind !== 'link' || !facet.uri) continue;
    addUrlSignal(facet.uri, externalUrls, domains);
    if (facet.domain) domains.add(normalizeDomain(facet.domain));
  }

  if (post.embed?.type === 'external' || post.embed?.type === 'video' || post.embed?.type === 'audio') {
    addUrlSignal(post.embed.url, externalUrls, domains);
    domains.add(normalizeDomain(post.embed.domain));
  } else if (post.embed?.type === 'quote') {
    quotedPostUri = post.embed.post.id;
    if (post.embed.externalLink?.url) {
      addUrlSignal(post.embed.externalLink.url, externalUrls, domains);
    }
    if (post.embed.externalLink?.domain) {
      domains.add(normalizeDomain(post.embed.externalLink.domain));
    }
  }

  const canonicalEntityIds = extractCanonicalEntityIds(post);

  return {
    uri: post.id,
    ...(post.cid ? { cid: post.cid } : {}),
    ...(post.threadRoot?.id ? { threadRootUri: post.threadRoot.id } : {}),
    ...(quotedPostUri ? { quotedPostUri } : {}),
    ...(externalUrls.size > 0 ? { externalUrls: [...externalUrls] } : {}),
    ...(domains.size > 0 ? { domains: [...domains].filter(Boolean) } : {}),
    ...(canonicalEntityIds.length > 0 ? { canonicalEntityIds } : {}),
    authorDid: post.author.did,
  };
}

export function buildStoryClustersFromPosts(posts: MockPost[]): StoryCluster[] {
  return buildStoryClusters(posts.map(storyClusterInputFromMockPost));
}

function buildCluster(
  posts: StoryClusterInputPost[],
  signals: ClusterSignals[],
  indexes: number[],
): StoryCluster {
  const rootUris = collect(indexes, (index) => signals[index]!.roots);
  const quotedUris = collect(indexes, (index) => signals[index]!.quotes);
  const externalUrls = collect(indexes, (index) => signals[index]!.links);
  const entityIds = collect(indexes, (index) => signals[index]!.entities);
  const domains = collect(indexes, (index) => signals[index]!.domains);
  const postUris = indexes.map((index) => posts[index]!.uri);
  const primaryAnchor = rootUris[0] ?? quotedUris[0] ?? externalUrls[0] ?? postUris[0]!;

  return {
    id: `cluster:${primaryAnchor}`,
    rootUris,
    quotedUris,
    externalUrls,
    entityIds,
    domains,
    postUris,
    confidence: computeClusterConfidence(indexes, signals),
  };
}

function computeClusterConfidence(indexes: number[], signals: ClusterSignals[]): number {
  const sizeFactor = clamp01(indexes.length / 10);
  const sharedSignalFactor = clamp01(countSharedSignalKinds(indexes, signals) / 3);
  const domainDiversity = clamp01(collect(indexes, (index) => signals[index]!.domains).length / Math.max(1, indexes.length));

  return clamp01(
    0.45 * sizeFactor
    + 0.35 * sharedSignalFactor
    + 0.20 * domainDiversity,
  );
}

function countSharedSignalKinds(indexes: number[], signals: ClusterSignals[]): number {
  const signalKinds: Array<keyof Pick<ClusterSignals, 'roots' | 'quotes' | 'links' | 'entities'>> = [
    'roots',
    'quotes',
    'links',
    'entities',
  ];

  return signalKinds.filter((kind) => {
    const counts = new Map<string, number>();
    for (const index of indexes) {
      for (const value of signals[index]![kind]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts.values()].some((count) => count >= 2);
  }).length;
}

function sharesStrongSignal(left: ClusterSignals, right: ClusterSignals): boolean {
  return intersects(left.roots, right.roots)
    || intersects(left.quotes, right.quotes)
    || intersects(left.links, right.links)
    || intersects(left.entities, right.entities);
}

function extractSignals(post: StoryClusterInputPost): ClusterSignals {
  const roots = new Set<string>();
  roots.add(post.threadRootUri ?? post.uri);

  return {
    roots,
    quotes: new Set(normalizeValues(post.quotedPostUri ? [post.quotedPostUri] : [])),
    links: new Set(normalizeValues(post.externalUrls ?? [], normalizeUrl)),
    entities: new Set(normalizeValues(post.canonicalEntityIds ?? [])),
    domains: new Set(normalizeValues(post.domains ?? [], normalizeDomain)),
  };
}

function addUrlSignal(url: string, urls: Set<string>, domains: Set<string>): void {
  const normalizedUrl = normalizeUrl(url);
  if (normalizedUrl) urls.add(normalizedUrl);
  const domain = normalizeDomain(url);
  if (domain) domains.add(domain);
}

function extractCanonicalEntityIds(post: MockPost): string[] {
  const record = post as MockPost & {
    canonicalEntityIds?: unknown;
    entityIds?: unknown;
  };
  const candidates = Array.isArray(record.canonicalEntityIds)
    ? record.canonicalEntityIds
    : Array.isArray(record.entityIds)
      ? record.entityIds
      : [];

  return normalizeValues(candidates.filter((value): value is string => typeof value === 'string'));
}

function collect(
  indexes: number[],
  getValues: (index: number) => Set<string>,
): string[] {
  const seen = new Set<string>();
  for (const index of indexes) {
    for (const value of getValues(index)) {
      if (value) seen.add(value);
    }
  }
  return [...seen].sort();
}

function normalizeValues(
  values: string[],
  normalize: (value: string) => string | null = normalizeToken,
): string[] {
  return values
    .map(normalize)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = normalizeDomain(url.hostname);
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0]?.replace(/^www\./, '').toLowerCase() ?? '';
  }
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function find(parents: number[], index: number): number {
  const parent = parents[index] ?? index;
  if (parent !== index) {
    parents[index] = find(parents, parent);
  }
  return parents[index] ?? index;
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
