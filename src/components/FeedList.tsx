import React, { useState, useEffect, useRef } from 'react';
import { List, ListItem, Block, Button, Searchbar, Card, Navbar, Page, Toolbar, Link } from 'konsta/react';
import { feedService } from '../feeds.js';
import { Markdown } from './Markdown.js';
import { getMediaPlaybackPrefs, saveMediaPlaybackPrefs } from '../lib/mediaPlayback.js';
import type { Feed, FeedItem } from '../schema.js';

interface PodcastValueRecipient {
  name?: string;
  type?: string;
  address?: string;
  split?: string;
  fee?: string;
}

interface WebLNProvider {
  enable?: () => Promise<void>;
  keysend?: (args: { destination: string; amount: number; customRecords?: Record<string, string> }) => Promise<unknown>;
}

interface PodcastValueConfig {
  method?: string;
  type?: string;
  suggested?: string;
  recipients?: PodcastValueRecipient[];
}

interface FeedItemView extends FeedItem {
  transcriptUrl: string | null;
  chaptersUrl: string | null;
  valueConfig: PodcastValueConfig | null;
}

interface PodcastChapter {
  startTime: number;
  title: string;
  img?: string;
  url?: string;
}

/**
 * FeedList Component for managing and consuming multiple feed formats.
 * Supports RSS, ATOM, JSON Feed, JSON-LD, and RDF formats with automatic detection.
 * Content is normalized to standard FeedItem schema and rendered with markdown support.
 */

export const FeedList: React.FC = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItemView[]>([]);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadFeeds();
  }, []);

  const loadFeeds = async () => {
    const result = await feedService.getFeeds();
    setFeeds(result as Feed[]);
  };

  const handleAddFeed = async () => {
    if (!newFeedUrl.trim()) return;
    setIsLoading(true);
    try {
      await feedService.addFeed(newFeedUrl);
      setNewFeedUrl('');
      loadFeeds();
    } catch (error) {
      alert('Failed to add feed. Please check the URL.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFeed = async (feed: Feed) => {
    setSelectedFeed(feed);
    const items = await feedService.getFeedItems(feed.id);
    // Map snake_case from DB to camelCase for UI
    const mappedItems = items.map((item: any): FeedItemView => ({
      ...item,
      pubDate: item.pub_date,
      enclosureUrl: item.enclosure_url,
      enclosureType: item.enclosure_type,
      transcriptUrl: item.transcript_url,
      chaptersUrl: item.chapters_url,
      valueConfig: (() => {
        if (!item.value_config) return null;
        if (typeof item.value_config === 'object') return item.value_config;
        if (typeof item.value_config !== 'string') return null;
        try {
          return JSON.parse(item.value_config);
        } catch {
          return null;
        }
      })(),
    }));
    setFeedItems(mappedItems);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      <Navbar
        title="Feeds"
        subtitle={selectedFeed ? selectedFeed.title || '' : 'News, Podcasts, Videos'}
        left={selectedFeed && (
          <Link onClick={() => setSelectedFeed(null)}>Back</Link>
        )}
      />

      {!selectedFeed ? (
        <div className="flex-1 overflow-auto">
          <Block strong inset className="mt-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter Feed URL (RSS, Atom, JSON, RDF, JSON-LD)"
                className="flex-1 px-3 py-2 border rounded-md dark:bg-zinc-900 dark:border-zinc-800"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
              />
              <Button 
                onClick={handleAddFeed} 
                disabled={isLoading}
                className="w-24"
              >
                {isLoading ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </Block>

          <List strong inset>
            {feeds.length === 0 ? (
              <ListItem title="No feeds added yet" />
            ) : (
              feeds.map((feed) => (
                <ListItem
                  key={feed.id}
                  title={feed.title || 'Untitled Feed'}
                  subtitle={feed.category || 'News'}
                  text={`${feed.type.toUpperCase()} • ${feed.url}`}
                  link
                  onClick={() => handleSelectFeed(feed)}
                />
              ))
            )}
          </List>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {feedItems.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    {selectedFeed.category || 'News'}
                  </span>
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                    {selectedFeed.type}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-2 leading-tight">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {item.title}
                  </a>
                </h3>
                {item.enclosureUrl && (
                  <div className="mb-3">
                    {item.enclosureType && (
                      <MediaEnclosurePlayer
                        url={item.enclosureUrl}
                        type={item.enclosureType}
                        transcriptUrl={item.transcriptUrl ?? undefined}
                        chaptersUrl={item.chaptersUrl ?? undefined}
                        valueConfig={item.valueConfig ?? undefined}
                      />
                    )}
                  </div>
                )}
                <div className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3 mb-3">
                  <Markdown content={item.content || ''} />
                </div>
                <div className="flex justify-between items-center text-xs text-zinc-500">
                  <span>{item.author || selectedFeed.title}</span>
                  <span>{item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ''}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

interface MediaEnclosurePlayerProps {
  url: string;
  type: string;
  transcriptUrl: string | undefined;
  chaptersUrl: string | undefined;
  valueConfig: PodcastValueConfig | undefined;
}

const MediaEnclosurePlayer: React.FC<MediaEnclosurePlayerProps> = ({ url, type, transcriptUrl, chaptersUrl, valueConfig }) => {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const lastPersistAtRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const mediaKey = `feed:${type}:${url}`;
  const [chapters, setChapters] = useState<PodcastChapter[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [showValueDetails, setShowValueDetails] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false);
  const [boostStatus, setBoostStatus] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const isVideo = type.startsWith('video/');

  const parseTimeToSeconds = (raw: unknown): number | null => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
    const parts = value.split(':').map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      if (hours === undefined || minutes === undefined || seconds === undefined) return null;
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    if (parts.length === 2) {
      const [minutes, seconds] = parts;
      if (minutes === undefined || seconds === undefined) return null;
      return (minutes * 60) + seconds;
    }
    return null;
  };

  const normalizeChapter = (chapter: any): PodcastChapter | null => {
    if (!chapter || typeof chapter !== 'object') return null;
    const rawStart = chapter.startTime ?? chapter.start_time ?? chapter.start;
    const startTime = parseTimeToSeconds(rawStart);
    const title = typeof chapter.title === 'string' && chapter.title.trim()
      ? chapter.title.trim()
      : null;
    if (startTime === null || !title) return null;
    return {
      startTime,
      title,
      ...(typeof chapter.img === 'string' && chapter.img ? { img: chapter.img } : {}),
      ...(typeof chapter.url === 'string' && chapter.url ? { url: chapter.url } : {}),
    };
  };

  const parseChaptersPayload = (payload: any): PodcastChapter[] => {
    const source = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.chapters)
        ? payload.chapters
        : [];
    return (source as unknown[])
      .map((entry) => normalizeChapter(entry))
      .filter((chapter: PodcastChapter | null): chapter is PodcastChapter => Boolean(chapter))
      .sort((a, b) => a.startTime - b.startTime);
  };

  const parseTranscriptPayload = (payload: unknown): string => {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return '';

    const data = payload as {
      text?: unknown;
      transcript?: unknown;
      body?: unknown;
      content?: unknown;
      segments?: Array<{ text?: unknown }>;
      cues?: Array<{ text?: unknown }>;
    };

    const directText = [data.text, data.transcript, data.body, data.content]
      .find((value) => typeof value === 'string');
    if (typeof directText === 'string') return directText;

    const segmentLines = [
      ...(Array.isArray(data.segments) ? data.segments : []),
      ...(Array.isArray(data.cues) ? data.cues : []),
    ]
      .map((entry) => (typeof entry?.text === 'string' ? entry.text.trim() : ''))
      .filter(Boolean);

    return segmentLines.join('\n');
  };

  useEffect(() => {
    setShowTranscript(false);
    setTranscriptText(null);
    setTranscriptLoading(false);
    setTranscriptError(null);
  }, [transcriptUrl]);

  useEffect(() => {
    let canceled = false;
    const loadTranscript = async () => {
      if (!showTranscript || !transcriptUrl || transcriptText) return;

      setTranscriptLoading(true);
      setTranscriptError(null);
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(transcriptUrl)}`;

      const parseResponse = async (response: Response): Promise<string> => {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const parsed = await response.json();
          return parseTranscriptPayload(parsed);
        }

        const rawText = await response.text();
        const trimmed = rawText.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return parseTranscriptPayload(JSON.parse(trimmed));
          } catch {
            return rawText;
          }
        }
        return rawText;
      };

      try {
        const direct = await fetch(transcriptUrl);
        if (!direct.ok) throw new Error('Direct transcript fetch failed');
        const parsed = await parseResponse(direct);
        if (!canceled) {
          if (parsed.trim()) setTranscriptText(parsed.trim());
          else setTranscriptError('Transcript is available but empty.');
        }
        return;
      } catch {
        try {
          const proxy = await fetch(proxyUrl);
          if (!proxy.ok) throw new Error('Proxy transcript fetch failed');
          const parsed = await parseResponse(proxy);
          if (!canceled) {
            if (parsed.trim()) setTranscriptText(parsed.trim());
            else setTranscriptError('Transcript is available but empty.');
          }
          return;
        } catch {
          if (!canceled) {
            setTranscriptError('Unable to load transcript inline.');
          }
        }
      } finally {
        if (!canceled) setTranscriptLoading(false);
      }
    };

    loadTranscript();
    return () => {
      canceled = true;
    };
  }, [showTranscript, transcriptText, transcriptUrl]);

  useEffect(() => {
    let canceled = false;
    const loadChapters = async () => {
      if (!chaptersUrl) {
        setChapters([]);
        setChapterError(null);
        return;
      }

      setChapterError(null);
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(chaptersUrl)}`;
      try {
        const direct = await fetch(chaptersUrl);
        if (!direct.ok) throw new Error('Direct chapter fetch failed');
        const directJson = await direct.json();
        if (!canceled) setChapters(parseChaptersPayload(directJson));
        return;
      } catch {
        try {
          const proxy = await fetch(proxyUrl);
          if (!proxy.ok) throw new Error('Proxy chapter fetch failed');
          const wrapped = await proxy.json();
          const payload = typeof wrapped?.contents === 'string' ? JSON.parse(wrapped.contents) : wrapped;
          if (!canceled) setChapters(parseChaptersPayload(payload));
          return;
        } catch {
          if (!canceled) {
            setChapters([]);
            setChapterError('Unable to load chapters for this episode.');
          }
        }
      }
    };

    loadChapters();
    return () => {
      canceled = true;
    };
  }, [chaptersUrl]);

  const jumpToChapter = (startTime: number) => {
    const media = mediaRef.current;
    if (media) {
      media.currentTime = startTime;
      setCurrentTime(startTime);
      if (media.paused) media.play();
    }
  };

  const getBoostRecipient = (): PodcastValueRecipient | null => {
    const recipients = Array.isArray(valueConfig?.recipients) ? valueConfig.recipients : [];
    if (recipients.length === 0) return null;

    const sorted = [...recipients].sort((a, b) => {
      const splitA = Number(a.split || 0);
      const splitB = Number(b.split || 0);
      return splitB - splitA;
    });
    return sorted.find((recipient) => Boolean(recipient.address)) ?? null;
  };

  const handleBoost = async () => {
    const recipient = getBoostRecipient();
    if (!recipient?.address) {
      setBoostStatus('No lightning recipient found for this episode.');
      return;
    }

    const wallet = (window as Window & { webln?: WebLNProvider }).webln;
    if (!wallet) {
      setBoostStatus('No WebLN wallet detected. Install or enable a WebLN-compatible wallet.');
      return;
    }

    if (typeof wallet.keysend !== 'function') {
      setBoostStatus('Connected wallet does not support keysend boosts.');
      return;
    }

    const suggested = Number(valueConfig?.suggested || 100);
    const amountSats = Number.isFinite(suggested) && suggested > 0
      ? Math.round(suggested)
      : 100;

    setIsBoosting(true);
    setBoostStatus(null);
    try {
      await wallet.enable?.();
      await wallet.keysend({
        destination: recipient.address,
        amount: amountSats,
      });
      setBoostStatus(`Boost sent: ${amountSats} sats to ${recipient.name || 'recipient'}.`);
    } catch (err) {
      setBoostStatus(err instanceof Error ? err.message : 'Boost failed.');
    } finally {
      setIsBoosting(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const safeSeconds = Math.floor(seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      media.play().catch(() => setIsPlaying(false));
      return;
    }
    media.pause();
  };

  const seekBy = (delta: number) => {
    const media = mediaRef.current;
    if (!media) return;
    const upperBound = duration || media.duration || 0;
    const nextTime = Math.max(0, Math.min(upperBound, media.currentTime + delta));
    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const media = mediaRef.current;
    if (!media) return;
    const nextTime = Number(event.target.value);
    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMute = () => {
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setIsMuted(media.muted);
  };

  const handleRateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const media = mediaRef.current;
    const nextRate = Number(event.target.value);
    if (!media || !Number.isFinite(nextRate) || nextRate <= 0) return;
    media.playbackRate = nextRate;
    setPlaybackRate(nextRate);
    saveMediaPlaybackPrefs(mediaKey, { playbackRate: nextRate });
  };

  useEffect(() => {
    return () => {
      const media = mediaRef.current;
      if (!media) return;
      saveMediaPlaybackPrefs(mediaKey, {
        positionSeconds: media.currentTime,
        playbackRate: media.playbackRate,
      });
    };
  }, [mediaKey]);

  return (
    <div className="rounded-lg overflow-hidden bg-zinc-900 text-white">
      {isVideo ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          preload="metadata"
          playsInline
          src={url}
          className="w-full"
          onLoadedMetadata={(event) => {
            const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            const prefs = getMediaPlaybackPrefs(mediaKey);
            setDuration(nextDuration);
            if (prefs?.playbackRate && prefs.playbackRate > 0) {
              event.currentTarget.playbackRate = prefs.playbackRate;
            }
            if (prefs?.positionSeconds && prefs.positionSeconds > 0) {
              event.currentTarget.currentTime = Math.min(prefs.positionSeconds, nextDuration || prefs.positionSeconds);
            }
            setCurrentTime(event.currentTarget.currentTime || 0);
            setIsMuted(event.currentTarget.muted);
            setPlaybackRate(event.currentTarget.playbackRate || 1);
          }}
          onTimeUpdate={(event) => {
            const nextTime = event.currentTarget.currentTime;
            setCurrentTime(nextTime);
            const now = Date.now();
            if (now - lastPersistAtRef.current >= 2000) {
              saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: nextTime,
                playbackRate: event.currentTarget.playbackRate,
              });
              lastPersistAtRef.current = now;
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={(event) => {
            setIsPlaying(false);
            saveMediaPlaybackPrefs(mediaKey, {
              positionSeconds: event.currentTarget.currentTime,
              playbackRate: event.currentTarget.playbackRate,
            });
          }}
          onEnded={(event) => {
            setIsPlaying(false);
            saveMediaPlaybackPrefs(mediaKey, {
              positionSeconds: 0,
              playbackRate: event.currentTarget.playbackRate,
            });
          }}
        />
      ) : (
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          preload="metadata"
          src={url}
          className="w-full h-10"
          onLoadedMetadata={(event) => {
            const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            const prefs = getMediaPlaybackPrefs(mediaKey);
            setDuration(nextDuration);
            if (prefs?.playbackRate && prefs.playbackRate > 0) {
              event.currentTarget.playbackRate = prefs.playbackRate;
            }
            if (prefs?.positionSeconds && prefs.positionSeconds > 0) {
              event.currentTarget.currentTime = Math.min(prefs.positionSeconds, nextDuration || prefs.positionSeconds);
            }
            setCurrentTime(event.currentTarget.currentTime || 0);
            setIsMuted(event.currentTarget.muted);
            setPlaybackRate(event.currentTarget.playbackRate || 1);
          }}
          onTimeUpdate={(event) => {
            const nextTime = event.currentTarget.currentTime;
            setCurrentTime(nextTime);
            const now = Date.now();
            if (now - lastPersistAtRef.current >= 2000) {
              saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: nextTime,
                playbackRate: event.currentTarget.playbackRate,
              });
              lastPersistAtRef.current = now;
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={(event) => {
            setIsPlaying(false);
            saveMediaPlaybackPrefs(mediaKey, {
              positionSeconds: event.currentTarget.currentTime,
              playbackRate: event.currentTarget.playbackRate,
            });
          }}
          onEnded={(event) => {
            setIsPlaying(false);
            saveMediaPlaybackPrefs(mediaKey, {
              positionSeconds: 0,
              playbackRate: event.currentTarget.playbackRate,
            });
          }}
        />
      )}

      <div className="px-3 py-2 bg-zinc-800/95">
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={handleSeek}
          aria-label={isVideo ? 'Seek video' : 'Seek audio'}
          className="w-full"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              aria-label={isPlaying ? 'Pause media' : 'Play media'}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => seekBy(-10)}
              className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              aria-label="Rewind 10 seconds"
            >
              -10s
            </button>
            <button
              type="button"
              onClick={() => seekBy(10)}
              className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              aria-label="Forward 10 seconds"
            >
              +10s
            </button>
            <button
              type="button"
              onClick={toggleMute}
              className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              aria-label={isMuted ? 'Unmute media' : 'Mute media'}
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <label className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition inline-flex items-center gap-1">
              <span>Speed</span>
              <select
                value={playbackRate}
                onChange={handleRateChange}
                aria-label={isVideo ? 'Video playback speed' : 'Audio playback speed'}
                className="bg-transparent border-none outline-none"
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
            {transcriptUrl && (
              <button
                type="button"
                onClick={() => setShowTranscript((prev) => !prev)}
                className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              >
                {showTranscript ? 'Hide Transcript' : 'Transcript'}
              </button>
            )}
            {chapters.length > 0 && (
              <button
                type="button"
                onClick={() => setShowChapters(!showChapters)}
                className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
              >
                Chapters
              </button>
            )}
            {valueConfig && (
              <>
                <button
                  type="button"
                  className="px-2 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-500 transition text-white flex items-center gap-1"
                  onClick={handleBoost}
                  disabled={isBoosting}
                >
                  <span>⚡</span> {isBoosting ? 'Boosting...' : 'Boost'}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 transition"
                  onClick={() => setShowValueDetails((prev) => !prev)}
                >
                  Value
                </button>
              </>
            )}
          </div>
          <span className="text-xs tabular-nums text-zinc-200">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {chapterError && (
          <p className="mt-2 text-xs text-amber-300">{chapterError}</p>
        )}

        {boostStatus && (
          <p className="mt-2 text-xs text-emerald-300">{boostStatus}</p>
        )}

        {showTranscript && transcriptUrl && (
          <div className="mt-3 border-t border-zinc-700 pt-3 text-xs text-zinc-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Transcript</div>
              <a
                href={transcriptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-300 hover:text-white"
              >
                Open original
              </a>
            </div>
            {transcriptLoading && <p className="text-zinc-400">Loading transcript...</p>}
            {transcriptError && <p className="text-amber-300">{transcriptError}</p>}
            {transcriptText && (
              <pre className="max-h-44 overflow-auto rounded bg-zinc-950/70 p-2 whitespace-pre-wrap break-words leading-relaxed">
                {transcriptText}
              </pre>
            )}
          </div>
        )}

        {showValueDetails && valueConfig && (
          <div className="mt-3 border-t border-zinc-700 pt-3 text-xs text-zinc-300 space-y-1">
            <div className="font-semibold text-zinc-200">Value for Value</div>
            <div>Method: {valueConfig.method || 'unknown'}</div>
            <div>Type: {valueConfig.type || 'unknown'}</div>
            {valueConfig.suggested && <div>Suggested: {valueConfig.suggested}</div>}
            {Array.isArray(valueConfig.recipients) && valueConfig.recipients.length > 0 && (
              <div className="pt-1">
                <div className="mb-1 uppercase tracking-wider text-zinc-400">Recipients</div>
                {valueConfig.recipients.map((recipient, index) => (
                  <div key={`${recipient.address || 'recipient'}-${index}`} className="mb-1 rounded bg-zinc-800 px-2 py-1">
                    <span>{recipient.name || recipient.address || 'Recipient'}</span>
                    {recipient.split && <span> • Split {recipient.split}%</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showChapters && chapters.length > 0 && (
          <div className="mt-4 border-t border-zinc-700 pt-3 space-y-1 max-h-48 overflow-auto px-1">
            <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Chapters</div>
            {chapters.map((chapter, idx) => {
              const isPast = currentTime >= chapter.startTime;
              const nextChapter = idx < chapters.length - 1 ? chapters[idx + 1] : undefined;
              const isNext = nextChapter !== undefined && currentTime < nextChapter.startTime && isPast;
              const isCurrent = isNext || (idx === chapters.length - 1 && isPast);

              return (
                <button
                  key={idx}
                  onClick={() => jumpToChapter(chapter.startTime)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex justify-between items-center transition ${
                    isCurrent 
                      ? 'bg-blue-600 text-white' 
                      : 'hover:bg-zinc-700 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {chapter.img && (
                      <img src={chapter.img} alt="" className="w-4 h-4 rounded-sm object-cover" />
                    )}
                    <span className="truncate">{chapter.title}</span>
                  </div>
                  <span className="tabular-nums opacity-60 ml-2">
                    {formatTime(chapter.startTime)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
