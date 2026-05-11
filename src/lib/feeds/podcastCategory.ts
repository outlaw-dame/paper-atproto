import type { Feed } from '../../schema';

export function inferPodcastCategory(feed: Feed): string {
  const corpus = `${feed.title || ''} ${feed.description || ''}`.toLowerCase();
  if (/(sport|nfl|nba|mlb|soccer|football|basketball|baseball)/.test(corpus)) return 'Sports';
  if (/(tech|developer|software|ai|startup|code|programming)/.test(corpus)) return 'Technology';
  if (/(business|finance|market|economy|invest)/.test(corpus)) return 'Business';
  if (/(news|politic|world|daily)/.test(corpus)) return 'News';
  if (/(health|wellness|fitness|mental)/.test(corpus)) return 'Health';
  if (/(comedy|funny|humor)/.test(corpus)) return 'Comedy';
  return 'General';
}