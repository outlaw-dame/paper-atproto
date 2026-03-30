import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useState } from 'react';
import { feedService } from '../feeds.js';
import { useActivityStore } from '../store/activityStore.js';
import { searchPodcastIndex } from '../lib/podcastIndexClient.js';
const SUPPORTED_FEED_TYPES = ['RSS', 'ATOM', 'JSON Feed', 'JSON-LD', 'RDF/XML'];
const SAVED_EPISODES_KEY = 'paper-atproto.podcast.saved.v1';
const DOWNLOADED_EPISODES_KEY = 'paper-atproto.podcast.downloaded.v1';
function readEpisodeEntries(key) {
    if (typeof window === 'undefined')
        return [];
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function writeEpisodeEntries(key, entries) {
    if (typeof window === 'undefined')
        return;
    try {
        window.localStorage.setItem(key, JSON.stringify(entries));
    }
    catch {
        // ignore storage write errors
    }
}
function inferPodcastCategory(feed) {
    const corpus = `${feed.title || ''} ${feed.description || ''}`.toLowerCase();
    if (/(sport|nfl|nba|mlb|soccer|football|basketball|baseball)/.test(corpus))
        return 'Sports';
    if (/(tech|developer|software|ai|startup|code|programming)/.test(corpus))
        return 'Technology';
    if (/(business|finance|market|economy|invest)/.test(corpus))
        return 'Business';
    if (/(news|politic|world|daily)/.test(corpus))
        return 'News';
    if (/(health|wellness|fitness|mental)/.test(corpus))
        return 'Health';
    if (/(comedy|funny|humor)/.test(corpus))
        return 'Comedy';
    return 'General';
}
function SectionCard({ icon, title, subtitle, children, }) {
    return (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 10, background: 'var(--surface)', padding: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }, children: [_jsx("span", { "aria-hidden": true, style: { fontSize: 16 }, children: icon }), _jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }, children: title }), _jsx("p", { style: { margin: 0, fontSize: 11, color: 'var(--label-3)' }, children: subtitle })] })] }), children] }));
}
export default function FeedsSettingsPage() {
    const addAppNotification = useActivityStore((state) => state.addAppNotification);
    const [feeds, setFeeds] = useState([]);
    const [podcastEpisodes, setPodcastEpisodes] = useState([]);
    const [savedEpisodes, setSavedEpisodes] = useState([]);
    const [downloadedEpisodes, setDownloadedEpisodes] = useState([]);
    const [newFeedUrl, setNewFeedUrl] = useState('');
    const [podcastIndexQuery, setPodcastIndexQuery] = useState('');
    const [podcastIndexResults, setPodcastIndexResults] = useState([]);
    const [podcastIndexLoading, setPodcastIndexLoading] = useState(false);
    const [podcastIndexError, setPodcastIndexError] = useState(null);
    const [category, setCategory] = useState('News');
    const [isLoading, setIsLoading] = useState(false);
    const [podcastLoading, setPodcastLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const loadFeeds = async () => {
        const result = await feedService.getFeeds();
        setFeeds(result);
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
        const counts = new Map();
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
                const episodeGroups = await Promise.all(podcastFeeds.map(async (feed) => {
                    const items = await feedService.getFeedItems(feed.id);
                    const mapped = items
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
                }));
                if (!active)
                    return;
                setPodcastEpisodes(episodeGroups.flat());
            }
            catch {
                if (!active)
                    return;
                setPodcastEpisodes([]);
            }
            finally {
                if (active)
                    setPodcastLoading(false);
            }
        };
        loadPodcastEpisodes();
        return () => {
            active = false;
        };
    }, [podcastFeeds]);
    const toggleEpisodeEntry = (key, entry) => {
        const current = readEpisodeEntries(key);
        const exists = current.some((item) => item.id === entry.id);
        const next = exists
            ? current.filter((item) => item.id !== entry.id)
            : [entry, ...current];
        writeEpisodeEntries(key, next);
        if (key === SAVED_EPISODES_KEY)
            setSavedEpisodes(next);
        if (key === DOWNLOADED_EPISODES_KEY)
            setDownloadedEpisodes(next);
    };
    const handleAddFeed = async () => {
        const trimmedUrl = newFeedUrl.trim();
        if (!trimmedUrl)
            return;
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
        }
        catch {
            setError('Failed to add feed. Verify the URL and feed format.');
            addAppNotification({
                title: 'Feed Add Failed',
                message: `Could not add ${trimmedUrl}`,
                level: 'warning',
            });
        }
        finally {
            setIsLoading(false);
        }
    };
    const handlePodcastIndexSearch = async () => {
        const query = podcastIndexQuery.trim();
        if (!query)
            return;
        setPodcastIndexLoading(true);
        setPodcastIndexError(null);
        try {
            const results = await searchPodcastIndex(query, 15);
            setPodcastIndexResults(results);
        }
        catch (err) {
            setPodcastIndexResults([]);
            setPodcastIndexError(err instanceof Error ? err.message : 'Podcast Index search failed');
        }
        finally {
            setPodcastIndexLoading(false);
        }
    };
    const addPodcastIndexFeed = async (feedUrl) => {
        if (!feedUrl.trim())
            return;
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
        }
        catch {
            setError('Failed to add Podcast Index feed URL.');
            addAppNotification({
                title: 'Podcast Add Failed',
                message: `Could not add podcast ${feedUrl}`,
                level: 'warning',
            });
        }
    };
    return (_jsxs("div", { style: { display: 'grid', gap: 12 }, children: [_jsxs("div", { style: {
                    border: '1px solid var(--sep)',
                    borderRadius: 12,
                    background: 'var(--fill-1)',
                    padding: 12,
                    display: 'grid',
                    gap: 10,
                }, children: [_jsx("h4", { style: { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }, children: "Add feed" }), _jsxs("p", { style: { margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }, children: ["Supported feed types: ", SUPPORTED_FEED_TYPES.join(', '), "."] }), _jsx("input", { type: "url", value: newFeedUrl, onChange: (event) => setNewFeedUrl(event.target.value), placeholder: "https://example.com/feed.xml", style: {
                            width: '100%',
                            height: 40,
                            borderRadius: 10,
                            border: '1px solid var(--sep)',
                            background: 'var(--surface)',
                            color: 'var(--label-1)',
                            padding: '0 10px',
                            fontSize: 13,
                        } }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsxs("select", { value: category, onChange: (event) => setCategory(event.target.value), style: {
                                    flex: 1,
                                    height: 40,
                                    borderRadius: 10,
                                    border: '1px solid var(--sep)',
                                    background: 'var(--surface)',
                                    color: 'var(--label-1)',
                                    padding: '0 10px',
                                    fontSize: 13,
                                }, children: [_jsx("option", { value: "News", children: "News" }), _jsx("option", { value: "Podcasts", children: "Podcasts" }), _jsx("option", { value: "Videos", children: "Videos" }), _jsx("option", { value: "General", children: "General" })] }), _jsx("button", { type: "button", onClick: handleAddFeed, disabled: isLoading || !newFeedUrl.trim(), style: {
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
                                }, children: isLoading ? 'Adding...' : 'Add feed' })] }), error && (_jsx("p", { style: { margin: 0, fontSize: 12, color: '#d64545' }, children: error })), successMessage && (_jsx("p", { style: { margin: 0, fontSize: 12, color: '#2f8f46' }, children: successMessage }))] }), _jsxs("div", { style: {
                    border: '1px solid var(--sep)',
                    borderRadius: 12,
                    background: 'var(--fill-1)',
                    padding: 12,
                }, children: [_jsx("h4", { style: { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }, children: "Podcasts" }), _jsx("p", { style: { margin: '4px 0 10px', fontSize: 11, color: 'var(--label-3)' }, children: "Podcast hub with icon sections for shows, categories, saved, and downloaded." }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--surface)', marginBottom: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }, children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }, children: "Podcast Index Search" }), _jsx("span", { style: { margin: 0, fontSize: 11, color: 'var(--label-3)' }, children: "podcastindex.org" })] }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("input", { type: "text", value: podcastIndexQuery, onChange: (event) => setPodcastIndexQuery(event.target.value), placeholder: "Search podcasts (show name, host, topic)", style: {
                                            flex: 1,
                                            height: 36,
                                            borderRadius: 8,
                                            border: '1px solid var(--sep)',
                                            background: 'var(--fill-1)',
                                            color: 'var(--label-1)',
                                            padding: '0 10px',
                                            fontSize: 12,
                                        } }), _jsx("button", { type: "button", onClick: handlePodcastIndexSearch, disabled: podcastIndexLoading || !podcastIndexQuery.trim(), style: {
                                            height: 36,
                                            minWidth: 78,
                                            borderRadius: 8,
                                            border: 'none',
                                            background: podcastIndexLoading ? 'var(--fill-3)' : 'var(--blue)',
                                            color: podcastIndexLoading ? 'var(--label-3)' : '#fff',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            cursor: podcastIndexLoading ? 'default' : 'pointer',
                                        }, children: podcastIndexLoading ? 'Searching...' : 'Search' })] }), podcastIndexError && (_jsx("p", { style: { margin: '8px 0 0', fontSize: 11, color: '#d64545' }, children: podcastIndexError })), podcastIndexResults.length > 0 && (_jsx("div", { style: { marginTop: 8, display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }, children: podcastIndexResults.map((result) => (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }, children: result.title }), _jsx("p", { style: { margin: '2px 0 6px', fontSize: 11, color: 'var(--label-3)', wordBreak: 'break-all' }, children: result.url }), _jsx("button", { type: "button", onClick: () => addPodcastIndexFeed(result.url), style: {
                                                border: 'none',
                                                borderRadius: 8,
                                                background: 'var(--blue)',
                                                color: '#fff',
                                                fontSize: 11,
                                                fontWeight: 700,
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                            }, children: "Add Podcast Feed" })] }, `${result.id ?? result.url}-${result.url}`))) }))] }), _jsxs("div", { style: { display: 'grid', gap: 10 }, children: [_jsx(SectionCard, { icon: "\uD83C\uDF99\uFE0F", title: "Shows", subtitle: `${podcastFeeds.length} subscribed`, children: podcastFeeds.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No podcast shows yet. Add feeds with category set to Podcasts." })) : (_jsx("div", { style: { display: 'grid', gap: 8 }, children: podcastFeeds.map((feed) => (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }, children: feed.title || 'Untitled show' }), _jsx("p", { style: { margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)', wordBreak: 'break-all' }, children: feed.url })] }, feed.id))) })) }), _jsx(SectionCard, { icon: "\uD83C\uDFF7\uFE0F", title: "Categories", subtitle: "Detected podcast categories", children: podcastCategories.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No categories yet." })) : (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6 }, children: podcastCategories.map(([label, count]) => (_jsxs("span", { style: {
                                            fontSize: 11,
                                            fontWeight: 700,
                                            borderRadius: 999,
                                            background: 'var(--fill-2)',
                                            color: 'var(--label-2)',
                                            padding: '3px 8px',
                                        }, children: [label, " (", count, ")"] }, label))) })) }), _jsx(SectionCard, { icon: "\uD83D\uDD16", title: "Saved", subtitle: `${savedEpisodes.length} saved episodes`, children: savedEpisodes.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No saved episodes yet." })) : (_jsx("div", { style: { display: 'grid', gap: 8 }, children: savedEpisodes.slice(0, 8).map((episode) => (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }, children: episode.title }), _jsx("p", { style: { margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }, children: episode.showTitle })] }, episode.id))) })) }), _jsx(SectionCard, { icon: "\u2B07\uFE0F", title: "Downloaded", subtitle: `${downloadedEpisodes.length} downloaded shows/episodes`, children: downloadedEpisodes.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No downloaded podcast episodes yet." })) : (_jsx("div", { style: { display: 'grid', gap: 8 }, children: downloadedEpisodes.slice(0, 8).map((episode) => (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }, children: episode.title }), _jsx("p", { style: { margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }, children: episode.showTitle })] }, episode.id))) })) }), _jsx(SectionCard, { icon: "\uD83C\uDD95", title: "Recent Episodes", subtitle: "Quick save/download actions", children: podcastLoading ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "Loading episodes..." })) : podcastEpisodes.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No recent audio episodes found from your podcast feeds." })) : (_jsx("div", { style: { display: 'grid', gap: 8 }, children: podcastEpisodes.map((episode) => {
                                        const isSaved = savedEpisodes.some((item) => item.id === episode.id);
                                        const isDownloaded = downloadedEpisodes.some((item) => item.id === episode.id);
                                        return (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 8, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }, children: episode.title }), _jsx("p", { style: { margin: '2px 0 6px', fontSize: 11, color: 'var(--label-3)' }, children: episode.showTitle }), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsx("button", { type: "button", onClick: () => toggleEpisodeEntry(SAVED_EPISODES_KEY, episode), style: {
                                                                border: 'none',
                                                                borderRadius: 8,
                                                                background: isSaved ? 'var(--blue)' : 'var(--fill-2)',
                                                                color: isSaved ? '#fff' : 'var(--label-2)',
                                                                fontSize: 11,
                                                                fontWeight: 700,
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                            }, children: isSaved ? 'Saved' : 'Save' }), _jsx("button", { type: "button", onClick: () => toggleEpisodeEntry(DOWNLOADED_EPISODES_KEY, episode), style: {
                                                                border: 'none',
                                                                borderRadius: 8,
                                                                background: isDownloaded ? 'var(--blue)' : 'var(--fill-2)',
                                                                color: isDownloaded ? '#fff' : 'var(--label-2)',
                                                                fontSize: 11,
                                                                fontWeight: 700,
                                                                padding: '4px 8px',
                                                                cursor: 'pointer',
                                                            }, children: isDownloaded ? 'Downloaded' : 'Download' }), _jsx("a", { href: episode.link, target: "_blank", rel: "noreferrer", style: {
                                                                fontSize: 11,
                                                                fontWeight: 700,
                                                                color: 'var(--blue)',
                                                                textDecoration: 'none',
                                                                padding: '4px 4px',
                                                            }, children: "Open" })] })] }, episode.id));
                                    }) })) })] })] }), _jsxs("div", { style: {
                    border: '1px solid var(--sep)',
                    borderRadius: 12,
                    background: 'var(--fill-1)',
                    padding: 12,
                }, children: [_jsx("h4", { style: { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }, children: "All feeds" }), _jsxs("p", { style: { margin: '4px 0 10px', fontSize: 11, color: 'var(--label-3)' }, children: [feeds.length, " configured"] }), feeds.length === 0 ? (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)' }, children: "No feeds configured yet." })) : (_jsx("div", { style: { display: 'grid', gap: 8 }, children: feeds.map((feed) => (_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--surface)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsx("p", { style: { margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }, children: feed.title || 'Untitled feed' }), _jsx("span", { style: {
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: '2px 6px',
                                                borderRadius: 999,
                                                background: 'var(--fill-2)',
                                                color: 'var(--label-2)',
                                                textTransform: 'uppercase',
                                                letterSpacing: 0.3,
                                            }, children: feed.type || 'feed' })] }), _jsxs("p", { style: { margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }, children: [(feed.category || 'General'), " \u2022 ", feed.url] })] }, feed.id))) }))] })] }));
}
//# sourceMappingURL=FeedsSettingsPage.js.map