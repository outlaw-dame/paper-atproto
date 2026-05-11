import React, { useMemo } from 'react';
import type { Feed, FeedItem } from '../schema';
import type { PodcastIndexSearchFeed } from '../lib/podcastIndexClient';
import type { PodcastEpisodeEntry } from '../lib/podcastEpisodeStorage';
import { inferPodcastCategory } from '../lib/feeds/podcastCategory';

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

interface FeedsPodcastHubProps {
  podcastFeeds: Feed[];
  podcastEpisodes: Array<PodcastEpisodeEntry & { showTitle?: string; link?: string }>;
  savedEpisodes: PodcastEpisodeEntry[];
  downloadedEpisodes: PodcastEpisodeEntry[];
  podcastLoading: boolean;
  podcastIndexQuery: string;
  podcastIndexResults: PodcastIndexSearchFeed[];
  podcastIndexLoading: boolean;
  podcastIndexError: string | null;
  onPodcastIndexQueryChange: (value: string) => void;
  onPodcastIndexSearch: () => void;
  onAddPodcastIndexFeed: (feedUrl: string) => void;
  onToggleSavedEpisode: (entry: PodcastEpisodeEntry) => void;
  onToggleDownloadedEpisode: (entry: PodcastEpisodeEntry) => void;
}

export default function FeedsPodcastHub({
  podcastFeeds,
  podcastEpisodes,
  savedEpisodes,
  downloadedEpisodes,
  podcastLoading,
  podcastIndexQuery,
  podcastIndexResults,
  podcastIndexLoading,
  podcastIndexError,
  onPodcastIndexQueryChange,
  onPodcastIndexSearch,
  onAddPodcastIndexFeed,
  onToggleSavedEpisode,
  onToggleDownloadedEpisode,
}: FeedsPodcastHubProps) {
  const podcastCategories = useMemo(() => {
    const counts = new Map<string, number>();
    podcastFeeds.forEach((feed) => {
      const bucket = inferPodcastCategory(feed);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [podcastFeeds]);

  return (
    <div style={{ border: '1px solid var(--sep)', borderRadius: 12, background: 'var(--fill-1)', padding: 12 }}>
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
            onChange={(event) => onPodcastIndexQueryChange(event.target.value)}
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
            onClick={onPodcastIndexSearch}
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
                  onClick={() => onAddPodcastIndexFeed(result.url)}
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
                        onClick={() => onToggleSavedEpisode(episode)}
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
                        onClick={() => onToggleDownloadedEpisode(episode)}
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
  );
}