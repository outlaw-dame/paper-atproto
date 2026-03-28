import { inferenceClient } from '../../workers/InferenceClient.js';
import type { MockPost } from '../../data/mockData.js';
import type { FilterContext, KeywordFilterRule, PostFilterMatch } from './types.js';

const EMBEDDING_CACHE_MAX = 1_000;
const embeddingCache = new Map<string, number[]>();

function sanitizeForBoundary(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.now() > Date.parse(expiresAt);
}

function containsWholeWord(text: string, phrase: string): boolean {
  const source = sanitizeForBoundary(phrase);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${source}([^\\p{L}\\p{N}_]|$)`, 'iu');
  return re.test(text);
}

function containsKeyword(text: string, phrase: string, wholeWord: boolean): boolean {
  if (!phrase.trim()) return false;
  if (wholeWord) return containsWholeWord(text, phrase);
  return text.toLowerCase().includes(phrase.toLowerCase());
}

async function embedText(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase();
  if (!key) return [];
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const embedding = await inferenceClient.embed(key);
  embeddingCache.set(key, embedding);
  if (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    embeddingCache.delete(embeddingCache.keys().next().value!);
  }
  return embedding;
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function searchableTextForPost(post: MockPost): string {
  const mediaAlt = (post.media ?? []).map((m) => m.alt ?? '').join(' ');
  const embedBits = post.embed
    ? [
        'title' in post.embed ? post.embed.title ?? '' : '',
        'description' in post.embed ? post.embed.description ?? '' : '',
      ].join(' ')
    : '';
  return `${post.content} ${mediaAlt} ${embedBits}`.trim();
}

export function activeRulesForContext(
  rules: KeywordFilterRule[],
  context: FilterContext,
): KeywordFilterRule[] {
  return rules.filter((rule) => rule.enabled && rule.contexts.includes(context) && !isExpired(rule.expiresAt));
}

export function getKeywordMatches(
  text: string,
  rules: KeywordFilterRule[],
): PostFilterMatch[] {
  const matches: PostFilterMatch[] = [];
  for (const rule of rules) {
    if (containsKeyword(text, rule.phrase, rule.wholeWord)) {
      matches.push({
        ruleId: rule.id,
        phrase: rule.phrase,
        action: rule.action,
        matchType: 'keyword',
      });
    }
  }
  return matches;
}

export async function getSemanticMatches(
  text: string,
  rules: KeywordFilterRule[],
): Promise<PostFilterMatch[]> {
  const semanticRules = rules.filter((rule) => rule.semantic);
  if (semanticRules.length === 0) return [];
  const matches: PostFilterMatch[] = [];
  const postEmbedding = await embedText(text);
  if (postEmbedding.length === 0) return matches;

  const phraseEmbeddings = await Promise.all(semanticRules.map((rule) => embedText(rule.phrase)));

  for (let i = 0; i < semanticRules.length; i += 1) {
    const rule = semanticRules[i];
    const phraseEmbedding = phraseEmbeddings[i];
    if (!rule || !phraseEmbedding) continue;
    const score = cosine(postEmbedding, phraseEmbedding);
    if (score >= rule.semanticThreshold) {
      matches.push({
        ruleId: rule.id,
        phrase: rule.phrase,
        action: rule.action,
        matchType: 'semantic',
        score,
      });
    }
  }

  return matches;
}
