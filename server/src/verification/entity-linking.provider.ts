import { env } from '../config/env.js';

export type EntityLinkingProviderType = 'heuristic' | 'rel' | 'dbpedia' | 'wikidata' | 'hybrid';

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

const CONCEPT_ALIASES: Record<string, string[]> = {
  ai: ['ai', 'a.i.', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'llms'],
  fediverse: ['fediverse', 'fedi'],
  atproto: ['atproto', 'at proto', 'authenticated transfer protocol', 'bluesky protocol'],
  decentralization: ['decentralization', 'decentralisation', 'decentralized', 'decentralised'],
  moderation: ['moderation', 'content moderation'],
  misinformation: ['misinformation', 'disinformation'],
  privacy: ['privacy', 'data privacy'],
};

const STOP_WORDS = new Set([
  'the', 'and', 'this', 'that', 'with', 'from', 'into', 'about', 'they', 'them', 'their',
  'there', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'have', 'has',
  'were', 'been', 'being', 'your', 'you', 'our', 'its', 'just', 'also', 'than', 'then',
]);

const HINT_MATCH_SIMILARITY_THRESHOLD = 0.8;
const MAX_RETRY_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4_000;
const MAX_DBPEDIA_TEXT_CHARS = 1_500;
const MAX_MENTION_CHARS = 80;

interface TelemetryCounters {
  retryCount: number;
  fallbackCount: number;
  redactionCount: number;
  hybridAgreementCount: number;
  hybridResolutionCount: number;
}

const counters: TelemetryCounters = {
  retryCount: 0,
  fallbackCount: 0,
  redactionCount: 0,
  hybridAgreementCount: 0,
  hybridResolutionCount: 0,
};

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

function applyConceptCanonicalization(normalized: string): string {
  for (const aliases of Object.values(CONCEPT_ALIASES)) {
    if (aliases.includes(normalized)) return aliases[0] ?? normalized;
  }
  return normalized;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
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

function combinedEntitySimilarity(a: string, b: string): number {
  return diceSimilarity(a, b) * 0.7 + jaccardSimilarity(tokenSet(a), tokenSet(b)) * 0.3;
}

function stableId(prefix: string, label: string): string {
  const slug = normalize(label)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${prefix}:${slug || 'unknown'}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isSecureEndpoint(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:' && isLocalhost(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 60_000));
  return null;
}

function computeBackoffMs(attempt: number): number {
  const cap = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

function shouldRetryHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function sanitizeOutboundText(value: string): string {
  let result = value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => {
    counters.redactionCount += 1;
    return '[redacted-email]';
  });
  result = result.replace(/\+?\d[\d\s().\-]{6,}\d/g, () => {
    counters.redactionCount += 1;
    return '[redacted-phone]';
  });
  return result.replace(/\s+/g, ' ').trim().slice(0, MAX_DBPEDIA_TEXT_CHARS);
}

function sanitizeMention(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MENTION_CHARS);
}

async function fetchJsonWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (!response.ok) {
        if (attempt < MAX_RETRY_ATTEMPTS && shouldRetryHttpStatus(response.status)) {
          counters.retryCount += 1;
          const retryAfter = parseRetryAfterMs(response.headers.get('Retry-After'));
          await sleep(retryAfter ?? computeBackoffMs(attempt));
          continue;
        }
        return null;
      }

      const data = await response.json();
      const errorList = (data as { errors?: Array<{ code?: string }> })?.errors;
      const firstCode = errorList?.[0]?.code;
      if (attempt < MAX_RETRY_ATTEMPTS && (firstCode === 'maxlag' || firstCode === 'ratelimited')) {
        counters.retryCount += 1;
        const retryAfter = parseRetryAfterMs(response.headers.get('Retry-After'));
        await sleep(retryAfter ?? computeBackoffMs(attempt));
        continue;
      }

      return data;
    } catch (error) {
      if (attempt < MAX_RETRY_ATTEMPTS && !isAbortError(error)) {
        counters.retryCount += 1;
        await sleep(computeBackoffMs(attempt));
        continue;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  return fetchJsonWithRetry(url, init, timeoutMs);
}

class HeuristicEntityLinkingProvider implements EntityLinkingProvider {
  async linkEntities(text: string, topicHints: string[]): Promise<LinkedEntity[]> {
    const out = new Map<string, LinkedEntity>();
    const lower = text.toLowerCase();

    for (const rawHint of topicHints) {
      const hint = applyConceptCanonicalization(normalize(rawHint));
      if (!hint) continue;
      const id = stableId('hint', hint);
      out.set(id, {
        mention: rawHint,
        canonicalId: stableId('topic', hint),
        canonicalLabel: hint,
        confidence: 0.9,
        provider: 'heuristic',
      });
    }

    const handleMatches = text.match(/@([a-z0-9._-]{2,63}(?:\.[a-z0-9._-]{2,63})?)/gi) ?? [];
    for (const handle of handleMatches.slice(0, 12)) {
      const cleaned = handle.replace(/^@/, '');
      const normalized = normalize(cleaned);
      if (!normalized) continue;
      const id = stableId('person', normalized);
      if (out.has(id)) continue;
      out.set(id, {
        mention: handle,
        canonicalId: id,
        canonicalLabel: cleaned,
        confidence: 0.88,
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
      const label = applyConceptCanonicalization(normalize(tag.slice(1)));
      if (!label) continue;
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

    for (const aliases of Object.values(CONCEPT_ALIASES)) {
      const present = aliases.filter((alias) => lower.includes(alias));
      if (present.length === 0) continue;
      const canonical = aliases[0];
      if (!canonical) continue;
      const id = stableId('topic', canonical);
      if (out.has(id)) continue;
      out.set(id, {
        mention: canonical,
        canonicalId: id,
        canonicalLabel: canonical,
        confidence: 0.82,
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
    const sanitizedText = sanitizeOutboundText(text);
    if (!sanitizedText) return [];

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'paper-atproto/1.0 (+https://github.com/damonoutlaw/paper-atproto)',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body = new URLSearchParams({
      text: sanitizedText,
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

class WikidataEntityLinkingProvider implements EntityLinkingProvider {
  constructor(private readonly endpoint: string) {}

  private extractMentions(text: string, topicHints: string[]): Array<{ raw: string; normalized: string }> {
    const mentions = new Map<string, string>();

    const remember = (raw: string) => {
      const sanitized = sanitizeMention(raw);
      const normalized = normalize(sanitized);
      if (!normalized || normalized.length < 2) return;
      if (!mentions.has(normalized)) mentions.set(normalized, sanitized);
    };

    for (const hint of topicHints) {
      remember(hint);
    }

    for (const hashtag of text.match(/#([\w.-]{2,50})/g) ?? []) {
      remember(applyConceptCanonicalization(normalize(hashtag.slice(1))));
    }

    for (const handle of text.match(/@([a-z0-9._-]{2,63}(?:\.[a-z0-9._-]{2,63})?)/gi) ?? []) {
      remember(handle.slice(1));
    }

    for (const properNoun of text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g) ?? []) {
      remember(properNoun);
    }

    return [...mentions.entries()]
      .slice(0, 12)
      .map(([normalized, raw]) => ({ raw, normalized }));
  }

  private pickBestResult(mention: string, search: unknown[]): LinkedEntity | null {
    if (!Array.isArray(search) || search.length === 0) return null;

    const mentionNorm = normalize(mention);
    const isQidQuery = /^q\d+$/i.test(mentionNorm);
    let best: LinkedEntity | null = null;
    let bestScore = -1;

    for (const candidate of search) {
      if (!candidate || typeof candidate !== 'object') continue;
      const row = candidate as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id : undefined;
      if (!id || !/^Q\d+$/i.test(id)) continue;

      const label = typeof row.label === 'string'
        ? row.label
        : typeof (row.display as Record<string, unknown> | undefined)?.label === 'object'
          ? String(((row.display as Record<string, unknown>).label as Record<string, unknown>).value ?? '')
          : '';

      const matchText = typeof (row.match as Record<string, unknown> | undefined)?.text === 'string'
        ? String((row.match as Record<string, unknown>).text)
        : '';

      const candidateLabel = label || matchText || id;
      const similarity = Math.max(
        combinedEntitySimilarity(mentionNorm, normalize(candidateLabel)),
        matchText ? combinedEntitySimilarity(mentionNorm, normalize(matchText)) : 0,
      );

      let score = similarity;
      const matchType = typeof (row.match as Record<string, unknown> | undefined)?.type === 'string'
        ? String((row.match as Record<string, unknown>).type)
        : '';
      if (matchType === 'label') score += 0.08;
      if (matchType === 'alias') score += 0.04;
      if (isQidQuery && id.toLowerCase() === mentionNorm) score += 0.2;

      if (score <= bestScore) continue;
      bestScore = score;
      best = {
        mention,
        canonicalId: `wikidata:${id}`,
        canonicalLabel: candidateLabel,
        confidence: clamp01(0.3 + 0.7 * Math.max(0, similarity)),
        provider: 'wikidata',
      };
    }

    return best;
  }

  async linkEntities(text: string, topicHints: string[]): Promise<LinkedEntity[]> {
    const mentions = this.extractMentions(text, topicHints);
    if (mentions.length === 0) return [];

    const linked: LinkedEntity[] = [];

    for (const mention of mentions) {
      const url = new URL(this.endpoint);
      url.searchParams.set('action', 'wbsearchentities');
      url.searchParams.set('format', 'json');
      url.searchParams.set('formatversion', '2');
      url.searchParams.set('language', 'en');
      url.searchParams.set('uselang', 'en');
      url.searchParams.set('type', 'item');
      url.searchParams.set('strictlanguage', 'false');
      url.searchParams.set('limit', '5');
      url.searchParams.set('maxlag', '5');
      url.searchParams.set('search', mention.raw);

      const data = await fetchJsonWithTimeout(
        url.toString(),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'paper-atproto/1.0 (+https://github.com/damonoutlaw/paper-atproto)',
            'Api-User-Agent': 'paper-atproto/1.0 (+https://github.com/damonoutlaw/paper-atproto)',
            'Accept-Encoding': 'gzip, deflate',
          },
        },
        env.VERIFY_ENTITY_LINKING_TIMEOUT_MS,
      );

      if (!data || typeof data !== 'object') continue;
      const search = (data as { search?: unknown }).search;
      const best = this.pickBestResult(mention.raw, Array.isArray(search) ? search : []);
      if (!best) continue;
      linked.push(best);
    }

    return linked
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
  }
}

class HybridEntityLinkingProvider implements EntityLinkingProvider {
  constructor(
    private readonly dbpedia: EntityLinkingProvider,
    private readonly wikidata: EntityLinkingProvider,
  ) {}

  private chooseBestCanonical(
    mention: string,
    topicHints: string[],
    dbpediaCandidate?: LinkedEntity,
    wikidataCandidate?: LinkedEntity,
  ): LinkedEntity | null {
    if (!dbpediaCandidate && !wikidataCandidate) return null;

    const hintSimilarity = topicHints.length === 0
      ? 0
      : Math.max(
        ...topicHints.map((hint) => Math.max(
          combinedEntitySimilarity(mention, hint),
          dbpediaCandidate ? combinedEntitySimilarity(dbpediaCandidate.canonicalLabel, hint) : 0,
          wikidataCandidate ? combinedEntitySimilarity(wikidataCandidate.canonicalLabel, hint) : 0,
        )),
      );

    const dbScore = dbpediaCandidate
      ? dbpediaCandidate.confidence * 0.55 +
        combinedEntitySimilarity(mention, dbpediaCandidate.canonicalLabel) * 0.30 +
        hintSimilarity * 0.15
      : -1;

    const wdScore = wikidataCandidate
      ? wikidataCandidate.confidence * 0.55 +
        combinedEntitySimilarity(mention, wikidataCandidate.canonicalLabel) * 0.30 +
        hintSimilarity * 0.15
      : -1;

    const winner = wdScore >= dbScore ? wikidataCandidate : dbpediaCandidate;
    if (!winner) return null;

    const agreementBonus = dbpediaCandidate && wikidataCandidate
      ? Math.max(
        combinedEntitySimilarity(dbpediaCandidate.canonicalLabel, wikidataCandidate.canonicalLabel),
        combinedEntitySimilarity(dbpediaCandidate.mention, wikidataCandidate.mention),
      )
      : 0;

    const base = Math.max(dbScore, wdScore);
    counters.hybridResolutionCount += 1;
    if (dbpediaCandidate && wikidataCandidate) counters.hybridAgreementCount += 1;
    return {
      mention,
      canonicalId: winner.canonicalId,
      canonicalLabel: winner.canonicalLabel,
      confidence: clamp01(base + agreementBonus * 0.12),
      provider: 'hybrid',
    };
  }

  async linkEntities(text: string, topicHints: string[]): Promise<LinkedEntity[]> {
    const [dbpediaResults, wikidataResults] = await Promise.all([
      this.dbpedia.linkEntities(text, topicHints).catch(() => []),
      this.wikidata.linkEntities(text, topicHints).catch(() => []),
    ]);

    const byMention = new Map<string, { mention: string; db?: LinkedEntity; wd?: LinkedEntity }>();

    const remember = (entity: LinkedEntity, source: 'db' | 'wd') => {
      const key = normalize(entity.mention);
      if (!key) return;
      const existing = byMention.get(key) ?? { mention: entity.mention };
      existing[source] = entity;
      byMention.set(key, existing);
    };

    for (const entity of dbpediaResults) remember(entity, 'db');
    for (const entity of wikidataResults) remember(entity, 'wd');

    const merged: LinkedEntity[] = [];
    for (const row of byMention.values()) {
      const chosen = this.chooseBestCanonical(row.mention, topicHints, row.db, row.wd);
      if (chosen) merged.push(chosen);
    }

    return merged.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
  }
}

export function createEntityLinkingProvider(): EntityLinkingProvider {
  const provider = env.VERIFY_ENTITY_LINKING_PROVIDER;
  const canUseDbpediaEndpoint = env.VERIFY_ENTITY_LINKING_ENDPOINT && isSecureEndpoint(env.VERIFY_ENTITY_LINKING_ENDPOINT);
  const canUseWikidataEndpoint = env.VERIFY_WIKIDATA_ENDPOINT && isSecureEndpoint(env.VERIFY_WIKIDATA_ENDPOINT);

  if (provider === 'rel' && env.VERIFY_ENTITY_LINKING_ENDPOINT) {
    return new RelEntityLinkingProvider(env.VERIFY_ENTITY_LINKING_ENDPOINT);
  }
  if (provider === 'dbpedia' && canUseDbpediaEndpoint) {
    return new DbpediaEntityLinkingProvider(
      env.VERIFY_ENTITY_LINKING_ENDPOINT,
      env.VERIFY_ENTITY_LINKING_API_KEY,
    );
  }
  if (provider === 'wikidata' && canUseWikidataEndpoint) {
    return new WikidataEntityLinkingProvider(env.VERIFY_WIKIDATA_ENDPOINT);
  }
  if (provider === 'hybrid' && canUseDbpediaEndpoint && canUseWikidataEndpoint) {
    return new HybridEntityLinkingProvider(
      new DbpediaEntityLinkingProvider(
        env.VERIFY_ENTITY_LINKING_ENDPOINT,
        env.VERIFY_ENTITY_LINKING_API_KEY,
      ),
      new WikidataEntityLinkingProvider(env.VERIFY_WIKIDATA_ENDPOINT),
    );
  }
  counters.fallbackCount += 1;
  return new HeuristicEntityLinkingProvider();
}

export interface EntityLinkingTelemetry {
  retryCount: number;
  fallbackCount: number;
  redactionCount: number;
  hybridAgreementCount: number;
  hybridResolutionCount: number;
  agreementRate: number;
}

export function getEntityLinkingTelemetry(): EntityLinkingTelemetry {
  const { hybridAgreementCount, hybridResolutionCount } = counters;
  return {
    ...counters,
    agreementRate: hybridResolutionCount > 0 ? hybridAgreementCount / hybridResolutionCount : 0,
  };
}

export function resetEntityLinkingTelemetry(): void {
  counters.retryCount = 0;
  counters.fallbackCount = 0;
  counters.redactionCount = 0;
  counters.hybridAgreementCount = 0;
  counters.hybridResolutionCount = 0;
}

export function computeEntityGrounding(topicHints: string[], linkedEntities: LinkedEntity[]): number {
  if (linkedEntities.length === 0) return topicHints.length > 0 ? 0.45 : 0.3;

  const avgLinkConfidence =
    linkedEntities.reduce((sum, entity) => sum + entity.confidence, 0) /
    Math.max(linkedEntities.length, 1);

  if (topicHints.length === 0) {
    return clamp01(0.35 + 0.55 * avgLinkConfidence);
  }

  const normalizedHints = topicHints
    .map((hint) => applyConceptCanonicalization(normalize(hint)))
    .filter(Boolean);
  if (normalizedHints.length === 0) {
    return clamp01(0.35 + 0.55 * avgLinkConfidence);
  }

  let matchedHints = 0;
  let similaritySum = 0;

  for (const hint of normalizedHints) {
    let best = 0;
    for (const entity of linkedEntities) {
      const s = Math.max(
        combinedEntitySimilarity(hint, entity.canonicalLabel),
        combinedEntitySimilarity(hint, entity.mention),
      );
      if (s > best) best = s;
    }
    if (best >= HINT_MATCH_SIMILARITY_THRESHOLD) matchedHints += 1;
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
