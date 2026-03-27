import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../config/env.js';

const SearchQuerySchema = z.object({
  term: z.string().trim().min(1).max(120),
  max: z.coerce.number().int().min(1).max(40).optional(),
});

interface PodcastIndexFeed {
  id?: number;
  title?: string;
  url?: string;
  description?: string;
  author?: string;
  image?: string;
  language?: string;
  categories?: Record<string, string>;
}

function buildPodcastIndexHeaders() {
  if (!env.PODCASTINDEX_API_KEY || !env.PODCASTINDEX_API_SECRET) return null;
  const unixTime = Math.floor(Date.now() / 1000).toString();
  const authToken = createHash('sha1')
    .update(env.PODCASTINDEX_API_KEY + env.PODCASTINDEX_API_SECRET + unixTime)
    .digest('hex');

  return {
    'X-Auth-Date': unixTime,
    'X-Auth-Key': env.PODCASTINDEX_API_KEY,
    Authorization: authToken,
    'User-Agent': env.PODCASTINDEX_USER_AGENT,
  };
}

export const podcastIndexRouter = new Hono();

podcastIndexRouter.get('/search', async (c) => {
  const parsed = SearchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Invalid Podcast Index search query', issues: parsed.error.issues }, 400);
  }

  const headers = buildPodcastIndexHeaders();
  if (!headers) {
    return c.json({
      ok: false,
      error: 'Podcast Index API is not configured on the server. Set PODCASTINDEX_API_KEY and PODCASTINDEX_API_SECRET.',
    }, 503);
  }

  const term = parsed.data.term;
  const max = parsed.data.max ?? 12;
  const endpoint = new URL('/api/1.0/search/byterm', env.PODCASTINDEX_BASE_URL);
  endpoint.searchParams.set('q', term);
  endpoint.searchParams.set('max', String(max));
  endpoint.searchParams.set('fulltext', 'true');
  endpoint.searchParams.set('clean', 'true');

  const response = await fetch(endpoint.toString(), { headers });
  if (!response.ok) {
    const body = await response.text();
    return c.json({ ok: false, error: 'Podcast Index request failed', details: body.slice(0, 300) }, 502);
  }

  const payload = await response.json() as { feeds?: PodcastIndexFeed[] };
  const feeds = (payload.feeds ?? []).map((feed) => ({
    id: feed.id,
    title: feed.title ?? 'Untitled podcast',
    url: feed.url ?? '',
    description: feed.description ?? '',
    author: feed.author ?? '',
    image: feed.image ?? '',
    language: feed.language ?? '',
    categories: feed.categories ?? {},
  })).filter((feed) => Boolean(feed.url));

  return c.json({ ok: true, feeds });
});
