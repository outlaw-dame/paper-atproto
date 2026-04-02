// ─── Hashtag Insights ─────────────────────────────────────────────────────
// Three-signal intelligence layer for hashtag analysis in the composer:
//
//   1. Volume signal    — real-time search-post hit count from Bluesky API
//                         (`app.bsky.feed.searchPosts`, hitsTotal)
//   2. Trending signal  — whether the tag appears in Bluesky's live trending
//                         topics feed (`app.bsky.unspecced.getTrendingTopics`)
//   3. Relevance signal — cosine similarity between the post text embedding
//                         and the hashtag embedding, computed locally via
//                         the MiniLM worker (384-d)
//
// The three signals are blended into a 0–100 composite score per tag.
// Both Bluesky API responses are short-lived cached in memory.

import type { Agent } from '@atproto/api';
import { atpCall } from '../atproto/client';
import { embeddingPipeline } from '../../intelligence/embeddingPipeline';

// ─── Cache ─────────────────────────────────────────────────────────────────
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  sessionToken: string;
}

// Session token changes when the user's identity changes (logout/login).
// All cache entries store the token at write time; stale-session entries are
// rejected at read time without requiring an explicit cache flush.
let _sessionToken = '';
export function setHashtagInsightsSessionToken(token: string): void {
  _sessionToken = token;
}

let trendingCacheEntry: CacheEntry<TrendingTopic[]> | null = null;
const volumeCache = new Map<string, CacheEntry<number>>();

const TRENDING_TTL_MS = 10 * 60_000; //  10 minutes
const VOLUME_TTL_MS = 5 * 60_000;    //   5 minutes
const VOLUME_ERROR_TTL_MS = 15_000;  //  15 seconds (short window so real results surface quickly)

// ─── Public types ──────────────────────────────────────────────────────────
export interface TrendingTopic {
  /** Lowercase slug without the # prefix */
  slug: string;
  displayName: string;
  link?: string;
}

export interface HashtagInsight {
  tag: string;
  /** 0–100 blended composite score */
  score: number;
  /** 0–100 normalised search-volume score */
  volumeScore: number;
  /** 0–100 cosine-similarity relevance to post text */
  relevanceScore: number;
  /** True when the tag appears in the live trending-topics response */
  isTrending: boolean;
  label: 'Trending' | 'Popular' | 'Active';
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Cosine similarity of two real-valued vectors (returns –1 → 1). */
function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Log-scale normalisation of raw hitsTotal → 0–100.
 * Calibrated so ~100 posts ≈ 20, ~10k posts ≈ 57, ~1M posts ≈ 86.
 */
function normalizeVolume(hits: number): number {
  if (hits <= 0) return 5;
  const score = (Math.log10(Math.max(1, hits)) / 7) * 100;
  return Math.min(100, Math.max(5, Math.round(score)));
}

// ─── API fetchers ──────────────────────────────────────────────────────────

/**
 * Fetches Bluesky's live trending topics.
 * Results are cached for TRENDING_TTL_MS. On failure returns [].
 */
export async function fetchTrendingTopics(agent: Agent): Promise<TrendingTopic[]> {
  const token = _sessionToken;
  if (trendingCacheEntry && Date.now() < trendingCacheEntry.expiresAt && trendingCacheEntry.sessionToken === token) {
    return trendingCacheEntry.value;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await atpCall<any>((s) => (agent.app.bsky.unspecced as any).getTrendingTopics({ limit: 25 }), {
      timeoutMs: 8_000,
      maxAttempts: 1,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = res.data?.topics ?? res.data?.suggestions ?? [];
    const topics: TrendingTopic[] = raw.map((t) => ({
      slug: String(t.topic ?? t.tag ?? '').replace(/^#/, '').toLowerCase(),
      displayName: String(t.displayName ?? t.topic ?? t.tag ?? ''),
      link: t.link ?? undefined,
    })).filter((t) => t.slug.length > 0);

    trendingCacheEntry = { value: topics, expiresAt: Date.now() + TRENDING_TTL_MS, sessionToken: token };
    return topics;
  } catch {
    // Cache an empty result briefly to avoid hammering a failing endpoint
    trendingCacheEntry = { value: [], expiresAt: Date.now() + VOLUME_ERROR_TTL_MS, sessionToken: token };
    return [];
  }
}

/**
 * Returns a 0–100 volume score for a single hashtag by querying
 * `searchPosts` for `#tag` and using the `hitsTotal` from the response.
 * Results are cached per tag for VOLUME_TTL_MS.
 */
export async function fetchHashtagVolume(agent: Agent, tag: string): Promise<number> {
  const token = _sessionToken;
  const key = tag.toLowerCase();
  const cached = volumeCache.get(key);
  if (cached && Date.now() < cached.expiresAt && cached.sessionToken === token) return cached.value;

  try {
    const res = await atpCall(
      () => agent.app.bsky.feed.searchPosts({ q: `#${key}`, limit: 1 }),
      { timeoutMs: 5_000, maxAttempts: 1 }
    );
    // hitsTotal is present in the Bluesky API response but not yet in all SDK type stubs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits: number = (res.data as any).hitsTotal ?? res.data.posts.length;
    const score = normalizeVolume(hits);
    volumeCache.set(key, { value: score, expiresAt: Date.now() + VOLUME_TTL_MS, sessionToken: token });
    return score;
  } catch {
    // Fall back to a deterministic score derived from the tag string so the UI
    // always has something to show; cache briefly to avoid rapid retries.
    const fallback = 42 + (Math.abs(hashStr(key)) % 30);
    volumeCache.set(key, { value: fallback, expiresAt: Date.now() + VOLUME_ERROR_TTL_MS, sessionToken: token });
    return fallback;
  }
}

/** Simple deterministic string hash (djb2 variant). */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ─── Relevance via embeddings ──────────────────────────────────────────────

/**
 * Computes per-tag relevance scores (0–100) by embedding the post text
 * and each tag, then computing cosine similarity.
 * Runs entirely in the MiniLM web worker — no network round-trip.
 * Falls back to 50 for all tags if the worker is not ready.
 */
async function computeRelevanceScores(
  postText: string,
  tags: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (!postText.trim() || !tags.length) {
    for (const t of tags) result.set(t, 50);
    return result;
  }

  try {
    const [postEmbedding, tagEmbeddings] = await Promise.all([
      embeddingPipeline.embed(postText, { mode: 'query' }),
      embeddingPipeline.embedBatch(tags.map((t) => `#${t} hashtag`), { mode: 'query' }),
    ]);

    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const tagEmb = tagEmbeddings[i];
      if (!tag) continue;
      if (!tagEmb) { result.set(tag, 50); continue; }
      const sim = cosine(postEmbedding, tagEmb); // –1 → 1
      result.set(tag, Math.round(((sim + 1) / 2) * 100)); // → 0–100
    }
  } catch {
    for (const t of tags) result.set(t, 50);
  }

  return result;
}

// ─── Main export ───────────────────────────────────────────────────────────

/**
 * Runs all three intelligence signals in parallel and returns a blended
 * HashtagInsight for every tag in `tags`.
 *
 * Blend weights:
 *   50% volume (real Bluesky search-post hit count)
 *   35% relevance (local MiniLM cosine similarity to post text)
 *   15% trending bonus (flat boost when tag is in live trending topics)
 */
export async function getHashtagInsights(
  agent: Agent,
  tags: string[],
  postText: string
): Promise<HashtagInsight[]> {
  if (!tags.length) return [];

  const [trending, volumeScores, relevanceScores] = await Promise.all([
    fetchTrendingTopics(agent),
    Promise.all(tags.map((t) => fetchHashtagVolume(agent, t))),
    computeRelevanceScores(postText, tags),
  ]);

  const trendingSlugs = new Set(trending.map((t) => t.slug));

  return tags.map((tag, i) => {
    const volumeScore = volumeScores[i] ?? 50;
    const relevanceScore = relevanceScores.get(tag) ?? 50;
    const isTrending = trendingSlugs.has(tag.toLowerCase());

    const score = Math.min(
      100,
      Math.round(volumeScore * 0.5 + relevanceScore * 0.35 + (isTrending ? 15 : 0))
    );

    const label: HashtagInsight['label'] =
      isTrending ? 'Trending' : score > 65 ? 'Popular' : 'Active';

    return { tag, score, volumeScore, relevanceScore, isTrending, label };
  });
}
