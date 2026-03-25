import { env } from '../config/env.js';

export type EntityLinkingProviderType = 'heuristic' | 'rel' | 'dbpedia';

export interface LinkedEntity {
  mention: string;
  canonicalId: string;
  canonicalLabel: string;
  confidence: number;
  provider: EntityLinkingProviderType;
}

export interface EntityLinkingProvider {
  linkEntities(text: string, topicHints: string[]): Promise<LinkedEntity[]>;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[@#]/, '')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Set<string> {
  const clean = normalize(value).replace(/\s+/g, '');
  if (clean.length < 2) return new Set([clean]);
  const grams = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) {
    grams.add(clean.slice(i, i + 2));
  }
  return grams;
}

function diceSimilarity(a: string, b: string): number {
  const ag = bigrams(a);
  const bg = bigrams(b);
  if (ag.size === 0 || bg.size === 0) return 0;
  let common = 0;
  for (const gram of ag) {
    if (bg.has(gram)) common += 1;
  }
  return (2 * common) / (ag.size + bg.size);
}

function stableId(prefix: string, label: string): string {
  const slug = normalize(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${prefix}:${slug || 'unknown'}`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

class HeuristicEntityLinkingProvider implements EntityLinkingProvider {
  async linkEntities(text: string, topicHints: string[]): Promise<LinkedEntity[]> {
    const out = new Map<string, LinkedEntity>();

    for (const rawHint of topicHints) {
      const hint = normalize(rawHint);
      if (!hint) continue;
      const id = stableId('hint', hint);
      out.set(id, {
        mention: rawHint,
        canonicalId: id,
        canonicalLabel: rawHint,
        confidence: 0.9,
        provider: 'heuristic',
      });
    }

    const properNouns = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g) ?? [];
    for (const token of properNouns.slice(0, 12)) {
      const label = token.trim();
      const id = stableId('name', label);
      if (out.has(id)) continue;
      out.set(id, {
        mention: label,
        canonicalId: id,
        canonicalLabel: label,
        confidence: 0.68,
        provider: 'heuristic',
      });
    }

    for (const tag of text.match(/#([\w.-]{2,50})/g) ?? []) {
      const label = tag.slice(1);
      const id = stableId('topic', label);
      if (out.has(id)) continue;
      out.set(id, {
        mention: tag,
        canonicalId: id,
        canonicalLabel: label,
        confidence: 0.75,
        provider: 'heuristic',
      });
    }

    return [...out.values()].slice(0, 20);
  }
}

class RelEntityLinkingProvider implements EntityLinkingProvider {
  constructor(private readonly endpoint: string) {}

  async linkEntities(text: string): Promise<LinkedEntity[]> {
    const payload = { text, spans: [] as Array<[number, number]> };
    const data = await fetchJsonWithTimeout(
      this.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      env.VERIFY_ENTITY_LINKING_TIMEOUT_MS,
    );

    if (!Array.isArray(data)) return [];
    const linked: LinkedEntity[] = [];

    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const mention = typeof row[2] === 'string' ? row[2] : undefined;
      const title = typeof row[3] === 'string' ? row[3] : undefined;
      const confidence = typeof row[4] === 'number' ? clamp01(row[4]) : 0.5;
      if (!mention || !title) continue;
      linked.push({
        mention,
        canonicalId: `wiki:${title}`,
        canonicalLabel: title.replace(/_/g, ' '),
        confidence,
        provider: 'rel',
      });
    }

    return linked.slice(0, 20);
  }
}

class DbpediaEntityLinkingProvider implements EntityLinkingProvider {
  constructor(private readonly endpoint: string, private readonly apiKey?: string) {}

  async linkEntities(text: string): Promise<LinkedEntity[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body = new URLSearchParams({
      text,
      confidence: '0.35',
      support: '20',
    }).toString();

    const data = await fetchJsonWithTimeout(
      this.endpoint,
      { method: 'POST', headers, body },
      env.VERIFY_ENTITY_LINKING_TIMEOUT_MS,
    );

    if (!data || typeof data !== 'object') return [];
    const resources = (data as { Resources?: unknown }).Resources;
    if (!Array.isArray(resources)) return [];

    const linked: LinkedEntity[] = [];
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const row = resource as Record<string, unknown>;
      const uri = typeof row['@URI'] === 'string' ? row['@URI'] : undefined;
      const mention = typeof row['@surfaceForm'] === 'string' ? row['@surfaceForm'] : undefined;
      const similarity = typeof row['@similarityScore'] === 'string' ? Number(row['@similarityScore']) : undefined;
      if (!uri || !mention) continue;
      linked.push({
        mention,
        canonicalId: uri,
        canonicalLabel: uri.split('/').pop()?.replace(/_/g, ' ') ?? mention,
        confidence: clamp01(Number.isFinite(similarity) ? (similarity as number) : 0.55),
        provider: 'dbpedia',
      });
    }

    return linked.slice(0, 20);
  }
}

export function createEntityLinkingProvider(): EntityLinkingProvider {
  const provider = env.VERIFY_ENTITY_LINKING_PROVIDER;
  if (provider === 'rel' && env.VERIFY_ENTITY_LINKING_ENDPOINT) {
    return new RelEntityLinkingProvider(env.VERIFY_ENTITY_LINKING_ENDPOINT);
  }
  if (provider === 'dbpedia' && env.VERIFY_ENTITY_LINKING_ENDPOINT) {
    return new DbpediaEntityLinkingProvider(
      env.VERIFY_ENTITY_LINKING_ENDPOINT,
      env.VERIFY_ENTITY_LINKING_API_KEY,
    );
  }
  return new HeuristicEntityLinkingProvider();
}

export function computeEntityGrounding(topicHints: string[], linkedEntities: LinkedEntity[]): number {
  if (linkedEntities.length === 0) return topicHints.length > 0 ? 0.45 : 0.3;

  const avgLinkConfidence =
    linkedEntities.reduce((sum, entity) => sum + entity.confidence, 0) /
    Math.max(linkedEntities.length, 1);

  if (topicHints.length === 0) {
    return clamp01(0.35 + 0.55 * avgLinkConfidence);
  }

  const normalizedHints = topicHints.map(normalize).filter(Boolean);
  if (normalizedHints.length === 0) {
    return clamp01(0.35 + 0.55 * avgLinkConfidence);
  }

  let matchedHints = 0;
  let similaritySum = 0;

  for (const hint of normalizedHints) {
    let best = 0;
    for (const entity of linkedEntities) {
      const s = Math.max(
        diceSimilarity(hint, entity.canonicalLabel),
        diceSimilarity(hint, entity.mention),
      );
      if (s > best) best = s;
    }
    if (best >= 0.58) matchedHints += 1;
    similaritySum += best;
  }

  const hintCoverage = matchedHints / normalizedHints.length;
  const avgHintSimilarity = similaritySum / normalizedHints.length;

  return clamp01(
    0.35 * hintCoverage +
    0.35 * avgHintSimilarity +
    0.30 * avgLinkConfidence,
  );
}
