import type { EntityImpact, EntityKind } from './interpolatorTypes';
import type { ResolvedFacet } from '../lib/resolver/atproto';

export interface EntityCatalogEntry {
  canonicalId: string;
  canonicalLabel: string;
  normalizedLabel: string;
  entityKind: EntityKind;
  aliases: Set<string>;
  mentionCount: number;
}

export type EntityCatalog = Map<string, EntityCatalogEntry>;

interface EntityCandidate {
  label: string;
  normalized: string;
  entityKind: EntityKind;
  confidence: number;
  mentionCount: number;
}

export interface StoryEntityGroup {
  canonicalId: string;
  label: string;
  entityKind: EntityKind;
  mentionCount: number;
  aliasCount: number;
  topAliases: string[];
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

const PROPER_NOUN_RE = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g;
const HASHTAG_RE = /#([\w.-]{2,50})/g;
const HANDLE_RE = /@([a-z0-9._-]{2,63}(?:\.[a-z0-9._-]{2,63})?)/gi;

const STOP_WORDS = new Set([
  'the', 'and', 'this', 'that', 'with', 'from', 'into', 'about', 'they', 'them', 'their',
  'there', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'have', 'has',
  'were', 'been', 'being', 'your', 'you', 'our', 'its', 'just', 'also', 'than', 'then',
]);

const ENTITY_MATCH_CONFIDENCE_THRESHOLD = 0.8;

// ─── Sentiment lexicons ───────────────────────────────────────────────────
// Lightweight word lists for assistive entity-level sentiment scoring.
// These are not exhaustive — they catch clear positive/negative signals only.

const POSITIVE_WORDS = new Set([
  'great', 'good', 'excellent', 'amazing', 'love', 'best', 'brilliant', 'fantastic',
  'perfect', 'helpful', 'impressive', 'useful', 'valuable', 'innovative', 'support',
  'agree', 'right', 'correct', 'well', 'nice', 'solid', 'strong', 'clear', 'fair',
  'smart', 'thoughtful', 'important', 'exciting', 'better', 'improved', 'proven',
  'trusted', 'credible', 'accurate', 'insightful', 'reasonable', 'effective',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'wrong', 'broken', 'failed', 'fail', 'poor', 'worst',
  'disagree', 'incorrect', 'false', 'misleading', 'dangerous', 'harmful', 'dishonest',
  'stupid', 'ridiculous', 'absurd', 'corrupt', 'lying', 'lied', 'lies', 'fraud',
  'scam', 'attack', 'blame', 'criticism', 'criticize', 'condemn', 'damage', 'problem',
  'failure', 'loss', 'risk', 'threat', 'biased', 'unreliable', 'flawed', 'exaggerated',
  'overblown', 'disproven', 'manipulative', 'mislead', 'propaganda', 'hypocritical',
]);

const NEGATORS = new Set(["not", "no", "never", "neither", "n't", "without", "hardly"]);

// Scans a ±60-char context window around the first mention of the entity label
// in the text. Returns a value in [−1, 1]. 0 means neutral / no signal.
function scoreEntitySentiment(text: string, entityLabel: string): number {
  const lower = text.toLowerCase();
  const labelLower = entityLabel.toLowerCase().replace(/^[@#]/, '');
  const idx = lower.indexOf(labelLower);
  const window = idx >= 0
    ? lower.slice(Math.max(0, idx - 60), idx + labelLower.length + 60)
    : lower.slice(0, 120);

  const tokens = window.split(/\W+/).filter(t => t.length > 1);
  let score = 0;
  let pendingNegation = false;

  for (const token of tokens) {
    if (NEGATORS.has(token)) {
      pendingNegation = true;
      continue;
    }
    if (POSITIVE_WORDS.has(token)) {
      score += pendingNegation ? -0.35 : 0.35;
      pendingNegation = false;
    } else if (NEGATIVE_WORDS.has(token)) {
      score += pendingNegation ? 0.35 : -0.35;
      pendingNegation = false;
    } else {
      pendingNegation = false;
    }
  }

  return Math.max(-1, Math.min(1, score));
}

function normalizeEntityText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[@#]/, '')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableEntityId(kind: EntityKind, normalized: string): string {
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `ent:${kind}:${slug || 'unknown'}`;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 1 && !STOP_WORDS.has(t)),
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
  const clean = value.replace(/\s+/g, ' ').trim().replace(/\s+/g, '');
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
  let intersection = 0;
  for (const gram of ag) {
    if (bg.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (ag.size + bg.size);
}

function combinedEntitySimilarity(a: string, b: string): number {
  return diceSimilarity(a, b) * 0.7 + jaccardSimilarity(tokenSet(a), tokenSet(b)) * 0.3;
}

function applyConceptCanonicalization(normalized: string): string {
  for (const aliases of Object.values(CONCEPT_ALIASES)) {
    if (aliases.includes(normalized)) return aliases[0] ?? normalized;
  }
  return normalized;
}

function classifyProperNounEntity(label: string): EntityKind {
  if (label.includes(' ')) return 'org';
  return 'person';
}

function pushCandidate(
  bucket: Map<string, EntityCandidate>,
  candidate: EntityCandidate,
): void {
  const key = `${candidate.entityKind}:${candidate.normalized}`;
  const existing = bucket.get(key);
  if (existing) {
    bucket.set(key, {
      ...existing,
      mentionCount: existing.mentionCount + candidate.mentionCount,
      confidence: Math.max(existing.confidence, candidate.confidence),
    });
    return;
  }
  bucket.set(key, candidate);
}

function extractEntityCandidates(text: string, facets: ResolvedFacet[]): EntityCandidate[] {
  const bucket = new Map<string, EntityCandidate>();
  const lower = text.toLowerCase();

  for (const facet of facets) {
    if (facet.kind === 'mention' && facet.did) {
      const didTail = facet.did.split(':').pop() ?? facet.did;
      const normalized = normalizeEntityText(didTail);
      if (!normalized) continue;
      pushCandidate(bucket, {
        label: `@${didTail}`,
        normalized,
        entityKind: 'person',
        confidence: 0.95,
        mentionCount: 1,
      });
    }
    if (facet.kind === 'hashtag') {
      const tag = text.slice(facet.byteStart, facet.byteEnd).replace(/^#/, '').trim();
      const normalizedTag = applyConceptCanonicalization(normalizeEntityText(tag));
      if (!normalizedTag) continue;
      pushCandidate(bucket, {
        label: `#${tag}`,
        normalized: normalizedTag,
        entityKind: 'concept',
        confidence: 0.9,
        mentionCount: 1,
      });
    }
  }

  for (const handleMatch of text.matchAll(HANDLE_RE)) {
    const rawHandle = handleMatch[1] ?? '';
    const normalized = normalizeEntityText(rawHandle);
    if (!normalized) continue;
    pushCandidate(bucket, {
      label: `@${rawHandle}`,
      normalized,
      entityKind: 'person',
      confidence: 0.88,
      mentionCount: 1,
    });
  }

  for (const hashtagMatch of text.matchAll(HASHTAG_RE)) {
    const rawTag = hashtagMatch[1] ?? '';
    const normalized = applyConceptCanonicalization(normalizeEntityText(rawTag));
    if (!normalized) continue;
    pushCandidate(bucket, {
      label: `#${rawTag}`,
      normalized,
      entityKind: 'concept',
      confidence: 0.86,
      mentionCount: 1,
    });
  }

  for (const [canonical, aliases] of Object.entries(CONCEPT_ALIASES)) {
    const found = aliases.filter(alias => lower.includes(alias));
    if (found.length === 0) continue;
    pushCandidate(bucket, {
      label: canonical,
      normalized: canonical,
      entityKind: 'concept',
      confidence: 0.82,
      mentionCount: found.length,
    });
  }

  for (const match of text.matchAll(PROPER_NOUN_RE)) {
    const label = match[1] ?? '';
    if (!label || label.length < 3) continue;
    const normalized = normalizeEntityText(label);
    if (!normalized || STOP_WORDS.has(normalized)) continue;
    pushCandidate(bucket, {
      label,
      normalized,
      entityKind: classifyProperNounEntity(label),
      confidence: 0.7,
      mentionCount: 1,
    });
  }

  return [...bucket.values()];
}

function findBestCatalogMatch(
  candidate: EntityCandidate,
  catalog: EntityCatalog,
): { entry: EntityCatalogEntry; confidence: number } | null {
  let best: { entry: EntityCatalogEntry; confidence: number } | null = null;

  for (const entry of catalog.values()) {
    if (entry.entityKind !== candidate.entityKind) continue;

    if (entry.aliases.has(candidate.normalized) || entry.normalizedLabel === candidate.normalized) {
      return { entry, confidence: 0.99 };
    }

    const combined = Math.max(
      combinedEntitySimilarity(candidate.normalized, entry.normalizedLabel),
      ...[...entry.aliases].map(alias => combinedEntitySimilarity(candidate.normalized, alias)),
    );

    if (combined >= ENTITY_MATCH_CONFIDENCE_THRESHOLD && (!best || combined > best.confidence)) {
      best = { entry, confidence: combined };
    }
  }

  return best;
}

export function linkAndMatchEntities(
  text: string,
  facets: ResolvedFacet[],
  catalog: EntityCatalog,
): EntityImpact[] {
  const candidates = extractEntityCandidates(text, facets);
  const impacts = new Map<string, EntityImpact>();

  for (const candidate of candidates) {
    const best = findBestCatalogMatch(candidate, catalog);

    let entry: EntityCatalogEntry;
    let isNewEntity = false;
    let matchConfidence = candidate.confidence;

    if (best) {
      entry = best.entry;
      matchConfidence = best.confidence;
      entry.aliases.add(candidate.normalized);
      entry.mentionCount += candidate.mentionCount;
    } else {
      isNewEntity = true;
      const canonicalLabel = candidate.label.replace(/^[@#]/, '') || candidate.normalized;
      entry = {
        canonicalId: stableEntityId(candidate.entityKind, candidate.normalized),
        canonicalLabel,
        normalizedLabel: candidate.normalized,
        entityKind: candidate.entityKind,
        aliases: new Set([candidate.normalized]),
        mentionCount: candidate.mentionCount,
      };
      catalog.set(entry.canonicalId, entry);
    }

    const sentimentShift = scoreEntitySentiment(text, candidate.label);

    const existingImpact = impacts.get(entry.canonicalId);
    if (existingImpact) {
      // Mention-count-weighted running average of sentimentShift
      const totalMentions = existingImpact.mentionCount + candidate.mentionCount;
      const avgSentiment = totalMentions > 0
        ? (existingImpact.sentimentShift * existingImpact.mentionCount + sentimentShift * candidate.mentionCount) / totalMentions
        : 0;
      impacts.set(entry.canonicalId, {
        ...existingImpact,
        mentionCount: totalMentions,
        sentimentShift: Math.max(-1, Math.min(1, avgSentiment)),
        isNewEntity: existingImpact.isNewEntity || isNewEntity,
      });
      continue;
    }

    impacts.set(entry.canonicalId, {
      entityText: entry.canonicalLabel,
      entityKind: entry.entityKind,
      sentimentShift,
      isNewEntity,
      mentionCount: candidate.mentionCount,
      canonicalEntityId: entry.canonicalId,
      canonicalLabel: entry.canonicalLabel,
      matchConfidence,
    });
  }

  return [...impacts.values()].slice(0, 8);
}

export function summarizeStoryEntities(texts: string[]): StoryEntityGroup[] {
  const catalog: EntityCatalog = new Map();

  for (const text of texts) {
    linkAndMatchEntities(text, [], catalog);
  }

  return [...catalog.values()]
    .map(entry => ({
      canonicalId: entry.canonicalId,
      label: entry.canonicalLabel,
      entityKind: entry.entityKind,
      mentionCount: entry.mentionCount,
      aliasCount: entry.aliases.size,
      topAliases: [...entry.aliases].slice(0, 3),
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 24);
}
