import { getConfiguredApiBaseUrl, resolveApiUrl } from './apiBase';

interface PodcastIndexSearchFeed {
  id?: number;
  title: string;
  url: string;
  description: string;
  author: string;
  image: string;
  language: string;
  categories: Record<string, string>;
}

interface PodcastIndexSearchResponse {
  ok: boolean;
  feeds?: PodcastIndexSearchFeed[];
  error?: string;
}

const BASE_URL = getConfiguredApiBaseUrl(
  (import.meta as any).env?.VITE_GLYMPSE_VERIFY_BASE_URL,
  (import.meta as any).env?.VITE_GLYMPSE_API_BASE_URL,
);

export async function searchPodcastIndex(term: string, max = 12): Promise<PodcastIndexSearchFeed[]> {
  const query = term.trim();
  if (!query) return [];

  const endpoint = new URL(resolveApiUrl('/api/podcastindex/search', BASE_URL), window.location.origin);
  endpoint.searchParams.set('term', query);
  endpoint.searchParams.set('max', String(max));

  const response = await fetch(endpoint.toString());
  const payload = await response.json() as PodcastIndexSearchResponse;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Podcast Index search failed');
  }

  return payload.feeds ?? [];
}

export type { PodcastIndexSearchFeed };
