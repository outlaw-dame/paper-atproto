import React, { useEffect, useMemo, useState } from 'react';
import { feedService } from '../feeds';
import { useActivityStore } from '../store/activityStore';
import { searchPodcastIndex, type PodcastIndexSearchFeed } from '../lib/podcastIndexClient';
import type { Feed, FeedItem } from '../schema';

type FeedCategory = 'News' | 'Podcasts' | 'Videos' | 'General';

const SUPPORTED_FEED_TYPES = ['RSS', 'ATOM', 'JSON Feed', 'JSON-LD', 'RDF/XML'];
const SAVED_EPISODES_KEY = 'paper-atproto.podcast.saved.v1';
const DOWNLOADED_EPISODES_KEY = 'paper-atproto.podcast.downloaded.v1';

interface PodcastEpisodeEntry {
  id: string;
  title: string;
  showTitle: string;
  link: string;
  pubDate?: string | undefined;
}

function readEpisodeEntries(key: string): PodcastEpisodeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PodcastEpisodeEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEpisodeEntries(key: string, entries: PodcastEpisodeEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // ignore storage write errors
  }
}

function inferPodcastCategory(feed: Feed): string {
  const corpus = `${feed.title || ''} ${feed.description || ''}`.toLowerCase();
  if (/(sport|nfl|nba|mlb|soccer|football|basketball|baseball)/.test(corpus)) return 'Sports';
  if (/(tech|developer|software|ai|startup|code|programming)/.test(corpus)) return 'Technology';
  if (/(business|finance|market|economy|invest)/.test(corpus)) return 'Business';
  if (/(news|politic|world|daily)/.test(corpus)) return 'News';
  if (/(health|wellness|fitness|mental)/.test(corpus)) return 'Health';
  if (/(comedy|funny|humor)/.test(corpus)) return 'Comedy';
  return 'General';
}

function SectionCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--sep)', borderRadius: 10, background: 'var(--surface)', padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span aria-hidden style={{ fontSize: 16 }}>{icon}</span>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }}>{title}</p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function FeedsSettingsPage() {
  const addAppNotification = useActivityStore((state) => state.addAppNotification);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [podcastEpisodes, setPodcastEpisodes] = useState<PodcastEpisodeEntry[]>([]);
  const [savedEpisodes, setSavedEpisodes] = useState<PodcastEpisodeEntry[]>([]);
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<PodcastEpisodeEntry[]>([]);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [podcastIndexQuery, setPodcastIndexQuery] = useState('');
  const [podcastIndexResults, setPodcastIndexResults] = useState<PodcastIndexSearchFeed[]>([]);
  const [podcastIndexLoading, setPodcastIndexLoading] = useState(false);
  const [podcastIndexError, setPodcastIndexError] = useState<string | null>(null);
  const [category, setCategory] = useState<FeedCategory>('News');
  const [isLoading, setIsLoading] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadFeeds = async () => {
    const result = await feedService.getFeeds();
    setFeeds(result as Feed[]);
  };

  useEffect(() => {
    loadFeeds().catch(() => setError('Unable to load feeds right now.'));
    setSavedEpisodes(readEpisodeEntries(SAVED_EPISODES_KEY));
    setDownloadedEpisodes(readEpisodeEntries(DOWNLOADED_EPISODES_KEY));
  }, []);

  const podcastFeeds = useMemo(() => {
    return feeds.filter((feed) => (feed.category || '').toLowerCase() === 'podcasts');
  }, [feeds]);

  const podcastCategories = useMemo(() => {
    const counts = new Map<string, number>();
    podcastFeeds.forEach((feed) => {
      const bucket = inferPodcastCategory(feed);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [podcastFeeds]);

  useEffect(() => {
    let active = true;
    const loadPodcastEpisodes = async () => {
      if (podcastFeeds.length === 0) {
        setPodcastEpisodes([]);
        return;
      }

      setPodcastLoading(true);
      try {
        const episodeGroups = await Promise.all(
          podcastFeeds.map(async (feed) => {
            const items = await feedService.getFeedItems(feed.id);
            const mapped = (items as FeedItem[])
              .filter((item) => (item.enclosureType || '').startsWith('audio/'))
              .slice(0, 3)
              .map((item) => ({
                id: item.id,
                title: item.title,
                showTitle: feed.title || 'Untitled show',
                link: item.link,
                pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
              }));
            return mapped;
          }),
        );

        if (!active) return;
        setPodcastEpisodes(episodeGroups.flat());
      } catch {
        if (!active) return;
        setPodcastEpisodes([]);
      } finally {
        if (active) setPodcastLoading(false);
      }
    };

    loadPodcastEpisodes();

    return () => {
      active = false;
    };
  }, [podcastFeeds]);

  const toggleEpisodeEntry = (key: string, entry: PodcastEpisodeEntry) => {
    const current = readEpisodeEntries(key);
    const exists = current.some((item) => item.id === entry.id);
    const next = exists
      ? current.filter((item) => item.id !== entry.id)
      : [entry, ...current];
    writeEpisodeEntries(key, next);
    if (key === SAVED_EPISODES_KEY) setSavedEpisodes(next);
    if (key === DOWNLOADED_EPISODES_KEY) setDownloadedEpisodes(next);
  };

  const handleAddFeed = async () => {
    const trimmedUrl = newFeedUrl.trim();
    if (!trimmedUrl) return;

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await feedService.addFeed(trimmedUrl, category);
      setNewFeedUrl('');
      setSuccessMessage('Feed added successfully.');
      addAppNotification({
        title: 'Feed Added',
        message: `Added ${trimmedUrl}`,
        level: 'success',
      });
      await loadFeeds();
    } catch {
      setError('Failed to add feed. Verify the URL and feed format.');
      addAppNotification({
        title: 'Feed Add Failed',
        message: `Could not add ${trimmedUrl}`,
        level: 'warning',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePodcastIndexSearch = async () => {
    const query = podcastIndexQuery.trim();
    if (!query) return;

    setPodcastIndexLoading(true);
    setPodcastIndexError(null);
    try {
      const results = await searchPodcastIndex(query, 15);
      setPodcastIndexResults(results);
    } catch (err) {
      setPodcastIndexResults([]);
      setPodcastIndexError(err instanceof Error ? err.message : 'Podcast Index search failed');
    } finally {
      setPodcastIndexLoading(false);
    }
  };

  const addPodcastIndexFeed = async (feedUrl: string) => {
    if (!feedUrl.trim()) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await feedService.addFeed(feedUrl, 'Podcasts');
      setSuccessMessage('Podcast feed added from Podcast Index.');
      addAppNotification({
        title: 'Podcast Added',
        message: `Added podcast ${feedUrl}`,
        level: 'success',
      });
      await loadFeeds();
    } catch {
      setError('Failed to add Podcast Index feed URL.');
      addAppNotification({
        title: 'Podcast Add Failed',
        message: `Could not add podcast ${feedUrl}`,
        level: 'warning',
      });
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        background: 'var(--fill-1)',
        padding: 12,
        display: 'grid',
        gap: 10,
      }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Add feed</h4>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
          Supported feed types: {SUPPORTED_FEED_TYPES.join(', ')}.
        </p>

        <input
          type="url"
          value={newFeedUrl}
          onChange={(event) => setNewFeedUrl(event.target.value)}
          placeholder="https://example.com/feed.xml"
          style={{
            width: '100%',
            height: 40,
            borderRadius: 10,
            border: '1px solid var(--sep)',
            background: 'var(--surface)',
            color: 'var(--label-1)',
            padding: '0 10px',
            fontSize: 13,
          }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as FeedCategory)}
            style={{
              flex: 1,
              height: 40,
              borderRadius: 10,
              border: '1px solid var(--sep)',
              background: 'var(--surface)',
              color: 'var(--label-1)',
              padding: '0 10px',
              fontSize: 13,
            }}
          >
            <option value="News">News</option>
            <option value="Podcasts">Podcasts</option>
            <option value="Videos">Videos</option>
            <option value="General">General</option>
          </select>

          <button
            type="button"
            onClick={handleAddFeed}
            disabled={isLoading || !newFeedUrl.trim()}
            style={{
              height: 40,
              minWidth: 90,
              borderRadius: 10,
              border: 'none',
              background: isLoading ? 'var(--fill-3)' : 'var(--blue)',
              color: isLoading ? 'var(--label-3)' : '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: isLoading ? 'default' : 'pointer',
              opacity: !newFeedUrl.trim() ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Adding...' : 'Add feed'}
          </button>
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: '#d64545' }}>{error}</p>
        )}

        {successMessage && (
          <p style={{ margin: 0, fontSize: 12, color: '#2f8f46' }}>{successMessage}</p>
        )}
      </div>

      <div style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        background: 'var(--fill-1)',
        padding: 12,
      }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Podcasts</h4>
        <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--label-3)' }}>
          Podcast hub with icon sections for shows, categories, saved, and downloaded.
        </p>

        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--surface)', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }}>Podcast Index Search</p>
            <span style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>podcastindex.org</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={podcastIndexQuery}
              onChange={(event) => setPodcastIndexQuery(event.target.value)}
              placeholder="Search podcasts (show name, host, topic)"
              style={{
                flex: 1,
                height: 36,
                borderRadius: 8,
                border: '1px solid var(--sep)',
                background: 'var(--fill-1)',
                color: 'var(--label-1)',
                padding: '0 10px',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={handlePodcastIndexSearch}
              disabled={podcastIndexLoading || !podcastIndexQuery.trim()}
              style={{
                height: 36,
                minWidth: 78,
                borderRadius: 8,
                border: 'none',
                background: podcastIndexLoading ? 'var(--fill-3)' : 'var(--blue)',
                color: podcastIndexLoading ? 'var(--label-3)' : '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: podcastIndexLoading ? 'default' : 'pointer',
              }}
            >
              {podcastIndexLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {podcastIndexError && (
            <p style={{ margin: '8px 0 0', fontSize: 11, color: '#d64545' }}>{podcastIndexError}</p>
          )}
          {podcastIndexResults.length > 0 && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {podcastIndexResults.map((result) => (
                <div key={`${result.id ?? result.url}-${result.url}`} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{result.title}</p>
                  <p style={{ margin: '2px 0 6px', fontSize: 11, color: 'var(--label-3)', wordBreak: 'break-all' }}>{result.url}</p>
                  <button
                    type="button"
                    onClick={() => addPodcastIndexFeed(result.url)}
                    style={{
                      border: 'none',
                      borderRadius: 8,
                      background: 'var(--blue)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Add Podcast Feed
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <SectionCard icon="🎙️" title="Shows" subtitle={`${podcastFeeds.length} subscribed`}>
            {podcastFeeds.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
                No podcast shows yet. Add feeds with category set to Podcasts.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {podcastFeeds.map((feed) => (
                  <div key={feed.id} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{feed.title || 'Untitled show'}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)', wordBreak: 'break-all' }}>{feed.url}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon="🏷️" title="Categories" subtitle="Detected podcast categories">
            {podcastCategories.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>No categories yet.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {podcastCategories.map(([label, count]) => (
                  <span
                    key={label}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: 999,
                      background: 'var(--fill-2)',
                      color: 'var(--label-2)',
                      padding: '3px 8px',
                    }}
                  >
                    {label} ({count})
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon="🔖" title="Saved" subtitle={`${savedEpisodes.length} saved episodes`}>
            {savedEpisodes.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
                No saved episodes yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {savedEpisodes.slice(0, 8).map((episode) => (
                  <div key={episode.id} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{episode.title}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }}>{episode.showTitle}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon="⬇️" title="Downloaded" subtitle={`${downloadedEpisodes.length} downloaded shows/episodes`}>
            {downloadedEpisodes.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
                No downloaded podcast episodes yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {downloadedEpisodes.slice(0, 8).map((episode) => (
                  <div key={episode.id} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{episode.title}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }}>{episode.showTitle}</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon="🆕" title="Recent Episodes" subtitle="Quick save/download actions">
            {podcastLoading ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>Loading episodes...</p>
            ) : podcastEpisodes.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
                No recent audio episodes found from your podcast feeds.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {podcastEpisodes.map((episode) => {
                  const isSaved = savedEpisodes.some((item) => item.id === episode.id);
                  const isDownloaded = downloadedEpisodes.some((item) => item.id === episode.id);
                  return (
                    <div key={episode.id} style={{ border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>{episode.title}</p>
                      <p style={{ margin: '2px 0 6px', fontSize: 11, color: 'var(--label-3)' }}>{episode.showTitle}</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => toggleEpisodeEntry(SAVED_EPISODES_KEY, episode)}
                          style={{
                            border: 'none',
                            borderRadius: 8,
                            background: isSaved ? 'var(--blue)' : 'var(--fill-2)',
                            color: isSaved ? '#fff' : 'var(--label-2)',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '4px 8px',
                            cursor: 'pointer',
                          }}
                        >
                          {isSaved ? 'Saved' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleEpisodeEntry(DOWNLOADED_EPISODES_KEY, episode)}
                          style={{
                            border: 'none',
                            borderRadius: 8,
                            background: isDownloaded ? 'var(--blue)' : 'var(--fill-2)',
                            color: isDownloaded ? '#fff' : 'var(--label-2)',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '4px 8px',
                            cursor: 'pointer',
                          }}
                        >
                          {isDownloaded ? 'Downloaded' : 'Download'}
                        </button>
                        <a
                          href={episode.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--blue)',
                            textDecoration: 'none',
                            padding: '4px 4px',
                          }}
                        >
                          Open
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        background: 'var(--fill-1)',
        padding: 12,
      }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>All feeds</h4>
        <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--label-3)' }}>{feeds.length} configured</p>

        {feeds.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
            No feeds configured yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {feeds.map((feed) => (
              <div key={feed.id} style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }}>
                    {feed.title || 'Untitled feed'}
                  </p>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'var(--fill-2)',
                    color: 'var(--label-2)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}>
                    {feed.type || 'feed'}
                  </span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }}>
                  {(feed.category || 'General')} • {feed.url}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
