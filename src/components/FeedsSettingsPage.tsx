import React, { useEffect, useMemo, useState } from 'react';
import { feedService } from '../feeds';
import { useActivityStore } from '../store/activityStore';
import { useUiStore } from '../store/uiStore';
import { searchPodcastIndex, type PodcastIndexSearchFeed } from '../lib/podcastIndexClient';
import type { Feed, FeedItem } from '../schema';
import { subscribeToExternalFeed } from '../lib/feedSubscriptions';
import FeedsPodcastHub from './FeedsPodcastHub';
import FeedsAllFeedsList from './FeedsAllFeedsList';
import {
  readEpisodeEntries,
  type PodcastEpisodeEntry,
  writeEpisodeEntries,
} from '../lib/podcastEpisodeStorage';

type FeedCategory = 'News' | 'Podcasts' | 'Videos' | 'General';

const SUPPORTED_FEED_TYPES = ['RSS', 'ATOM', 'JSON Feed', 'JSON-LD', 'RDF/XML'];
const SAVED_EPISODES_KEY = 'paper-atproto.podcast.saved.v1';
const DOWNLOADED_EPISODES_KEY = 'paper-atproto.podcast.downloaded.v1';

export default function FeedsSettingsPage() {
  const addAppNotification = useActivityStore((state) => state.addAppNotification);
  const feedsAdaptiveRanking = useUiStore((state) => state.feedsAdaptiveRanking);
  const toggleFeedsAdaptiveRanking = useUiStore((state) => state.toggleFeedsAdaptiveRanking);
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
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await subscribeToExternalFeed({
        rawUrl: newFeedUrl,
        category,
      });
      if (!result.ok) {
        setError(result.message);
        setSuccessMessage(null);
        addAppNotification({
          title: result.reason === 'invalid_url' ? 'Invalid Feed URL' : 'Feed Add Failed',
          message: result.reason === 'invalid_url'
            ? 'Only valid http(s) feed URLs are supported.'
            : `Could not add ${result.normalizedUrl}`,
          level: 'warning',
        });
        return;
      }

      setNewFeedUrl('');
      setSuccessMessage('Feed added successfully.');
      addAppNotification({
        title: 'Feed Added',
        message: `Added ${result.normalizedUrl}`,
        level: 'success',
      });
      await loadFeeds();
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
    setError(null);
    setSuccessMessage(null);
    const result = await subscribeToExternalFeed({
      rawUrl: feedUrl,
      category: 'Podcasts',
    });
    if (result.ok) {
      setSuccessMessage('Podcast feed added from Podcast Index.');
      addAppNotification({
        title: 'Podcast Added',
        message: `Added podcast ${result.normalizedUrl}`,
        level: 'success',
      });
      await loadFeeds();
      return;
    }

    setError(result.reason === 'invalid_url'
      ? 'Podcast Index returned an invalid feed URL.'
      : result.message);
    addAppNotification({
      title: result.reason === 'invalid_url' ? 'Invalid Feed URL' : 'Podcast Add Failed',
      message: result.reason === 'invalid_url'
        ? 'Podcast Index returned an invalid feed URL.'
        : `Could not add podcast ${result.normalizedUrl}`,
      level: 'warning',
    });
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
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Algorithm</h4>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={feedsAdaptiveRanking}
            onChange={() => toggleFeedsAdaptiveRanking()}
            style={{ marginTop: 2, width: 14, height: 14, flexShrink: 0 }}
          />
          <div>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--label-1)', lineHeight: '18px' }}>
              Adaptive ranking
            </span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.4, marginTop: 2 }}>
              Re-scores Feeds posts by engagement and recency. The raw chronological feed is preserved as a fallback.
            </span>
          </div>
        </label>
      </div>

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

      <FeedsPodcastHub
        podcastFeeds={podcastFeeds}
        podcastEpisodes={podcastEpisodes}
        savedEpisodes={savedEpisodes}
        downloadedEpisodes={downloadedEpisodes}
        podcastLoading={podcastLoading}
        podcastIndexQuery={podcastIndexQuery}
        podcastIndexResults={podcastIndexResults}
        podcastIndexLoading={podcastIndexLoading}
        podcastIndexError={podcastIndexError}
        onPodcastIndexQueryChange={setPodcastIndexQuery}
        onPodcastIndexSearch={handlePodcastIndexSearch}
        onAddPodcastIndexFeed={addPodcastIndexFeed}
        onToggleSavedEpisode={(episode) => toggleEpisodeEntry(SAVED_EPISODES_KEY, episode)}
        onToggleDownloadedEpisode={(episode) => toggleEpisodeEntry(DOWNLOADED_EPISODES_KEY, episode)}
      />
      <FeedsAllFeedsList feeds={feeds} />
    </div>
  );
}
