import { env } from '../config/env.js';
import { fetchJson } from '../lib/http.js';
import type { FactCheckMatch } from './types.js';

type ClaimReview = {
  publisher?: { name?: string; site?: string };
  url?: string;
  title?: string;
  reviewDate?: string;
  textualRating?: string;
  languageCode?: string;
};

type Claim = {
  text?: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: ClaimReview[];
};

type ClaimSearchResponse = { claims?: Claim[]; nextPageToken?: string };
type ImageSearchResponse = { results?: Array<{ claim?: Claim }>; nextPageToken?: string };

function normalizeMatch(claim: Claim, review: ClaimReview, matchConfidence: number): FactCheckMatch | null {
  if (!review.url) return null;
  return {
    claimText: claim.text ?? '',
    reviewUrl: review.url,
    matchConfidence,
    ...(claim.claimant !== undefined ? { claimant: claim.claimant } : {}),
    ...(claim.claimDate !== undefined ? { claimDate: claim.claimDate } : {}),
    ...(review.title !== undefined ? { reviewTitle: review.title } : {}),
    ...(review.publisher?.name !== undefined ? { publisherName: review.publisher.name } : {}),
    ...(review.publisher?.site !== undefined ? { publisherSite: review.publisher.site } : {}),
    ...(review.textualRating !== undefined ? { textualRating: review.textualRating } : {}),
    ...(review.languageCode !== undefined ? { languageCode: review.languageCode } : {}),
    ...(review.reviewDate !== undefined ? { reviewDate: review.reviewDate } : {}),
  };
}

function scoreMatch(query: string, claimText: string): number {
  const q = query.toLowerCase();
  const c = claimText.toLowerCase();
  if (!q || !c) return 0.5;
  if (q === c) return 0.98;
  if (c.includes(q) || q.includes(c)) return 0.9;
  const qTokens = new Set(q.split(/\W+/).filter(Boolean));
  const cTokens = new Set(c.split(/\W+/).filter(Boolean));
  const overlap = [...qTokens].filter((t) => cTokens.has(t)).length;
  return Math.min(0.89, overlap / Math.max(qTokens.size, cTokens.size, 1));
}

function normalizePageSize(value: number): string {
  if (!Number.isFinite(value)) return '10';
  return String(Math.max(1, Math.min(20, Math.floor(value))));
}

export class GoogleFactCheckProvider {
  private readonly apiKey: string | undefined;

  constructor(apiKey = env.GOOGLE_FACT_CHECK_API_KEY) {
    this.apiKey = apiKey;
  }

  async searchClaims(query: string, languageCode = 'en', pageSize = 10): Promise<FactCheckMatch[]> {
    if (!this.apiKey || !query.trim()) return [];

    const url = new URL('https://factchecktools.googleapis.com/v1alpha1/claims:search');
    url.searchParams.set('query', query);
    url.searchParams.set('languageCode', languageCode);
    url.searchParams.set('pageSize', normalizePageSize(pageSize));
    url.searchParams.set('key', this.apiKey);

    const data = await fetchJson<ClaimSearchResponse>(url.toString(), { method: 'GET' });
    const out: FactCheckMatch[] = [];

    for (const claim of data.claims ?? []) {
      for (const review of claim.claimReview ?? []) {
        const match = normalizeMatch(claim, review, scoreMatch(query, claim.text ?? ''));
        if (match) out.push(match);
      }
    }

    return out.sort((a, b) => b.matchConfidence - a.matchConfidence);
  }

  async imageSearch(imageUri: string, languageCode = 'en', pageSize = 10): Promise<FactCheckMatch[]> {
    if (!this.apiKey || !imageUri.trim()) return [];

    const url = new URL('https://factchecktools.googleapis.com/v1alpha1/claims:imageSearch');
    url.searchParams.set('imageUri', imageUri);
    url.searchParams.set('languageCode', languageCode);
    url.searchParams.set('pageSize', normalizePageSize(pageSize));
    url.searchParams.set('key', this.apiKey);

    const data = await fetchJson<ImageSearchResponse>(url.toString(), { method: 'GET' });
    const out: FactCheckMatch[] = [];

    for (const result of data.results ?? []) {
      const claim = result.claim;
      if (!claim) continue;
      for (const review of claim.claimReview ?? []) {
        const match = normalizeMatch(claim, review, 0.85);
        if (match) out.push(match);
      }
    }

    return out.sort((a, b) => b.matchConfidence - a.matchConfidence);
  }
}
