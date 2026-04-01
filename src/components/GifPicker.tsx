import React, { useMemo, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface KlipyGif {
  id: string;
  title: string;
  media_formats: {
    tinygif: { url: string; dims: [number, number]; size: number };
    gif: { url: string; dims: [number, number]; size: number };
  };
  url: string;
}

interface GifPickerProps {
  onSelect: (gif: KlipyGif) => void;
  onClose: () => void;
}

const KLIPY_API_KEY = (import.meta.env.VITE_KLIPY_API_KEY || '').trim();
const RAW_CLIENT_KEY = (import.meta.env.VITE_KLIPY_CLIENT_KEY || 'paper-atproto').trim();
const CLIENT_KEY = RAW_CLIENT_KEY.replace(/[^a-zA-Z0-9_]/g, '_') || 'paper_atproto';
const KLIPY_API_KEY_PLACEHOLDERS = new Set(['', 'your_klipy_api_key_here']);
const RECENTS_KEY = 'paper.gifpicker.recents';
const FAVORITES_KEY = 'paper.gifpicker.favorites';
const MAX_RECENTS = 30;
const MAX_FAVORITES = 80;

type GifTab = 'search' | 'recents' | 'favorites';
type PendingClearTarget = GifTab | null;

function isValidGif(value: unknown): value is KlipyGif {
  if (!value || typeof value !== 'object') return false;
  const gif = value as Partial<KlipyGif>;
  return typeof gif.id === 'string' && !!gif.media_formats?.tinygif?.url;
}

function readStoredGifs(key: string): KlipyGif[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidGif);
  } catch {
    return [];
  }
}

function writeStoredGifs(key: string, gifs: KlipyGif[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(gifs));
  } catch {
    // Ignore storage failures (private mode, quota limits, etc).
  }
}

function upsertGif(list: KlipyGif[], gif: KlipyGif, maxSize: number): KlipyGif[] {
  const next = [gif, ...list.filter((item) => item.id !== gif.id)];
  return next.slice(0, maxSize);
}

function isKlipyConfigured(): boolean {
  return !KLIPY_API_KEY_PLACEHOLDERS.has(KLIPY_API_KEY);
}

function getKlipySetupMessage(): string {
  return 'GIF search needs a valid Klipy API key. Set VITE_KLIPY_API_KEY in your .env file and reload the app.';
}

async function getKlipyErrorCode(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as {
      error?: {
        status?: string;
        details?: Array<{ reason?: string }>;
      };
    };
    return payload.error?.details?.find((detail) => typeof detail.reason === 'string')?.reason || payload.error?.status || null;
  } catch {
    return null;
  }
}

// Skeleton aspect ratios that approximate typical GIF shapes for a realistic shimmer grid
const SKELETON_RATIOS = [1.33, 0.75, 1, 1.5, 0.9, 1.2, 1, 0.75];

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect, onClose }) => {
  const [activeTab, setActiveTab] = useState<GifTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<KlipyGif[]>([]);
  const [recents, setRecents] = useState<KlipyGif[]>(() => readStoredGifs(RECENTS_KEY));
  const [favorites, setFavorites] = useState<KlipyGif[]>(() => readStoredGifs(FAVORITES_KEY));
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingClearTarget, setPendingClearTarget] = useState<PendingClearTarget>(null);
  const [draggingFavoriteId, setDraggingFavoriteId] = useState<string | null>(null);
  const [dragOverFavoriteId, setDragOverFavoriteId] = useState<string | null>(null);

  useEffect(() => {
    writeStoredGifs(RECENTS_KEY, recents);
  }, [recents]);

  useEffect(() => {
    writeStoredGifs(FAVORITES_KEY, favorites);
  }, [favorites]);

  const fetchGifs = async (query: string, signal: AbortSignal) => {
    if (!isKlipyConfigured()) {
      setLoading(false);
      setGifs([]);
      setErrorMessage(getKlipySetupMessage());
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const commonParams = new URLSearchParams({
        key: KLIPY_API_KEY,
        client_key: CLIENT_KEY,
        limit: '20',
        media_filter: 'tinygif,gif',
      });

      let response: Response;
      if (query) {
        const searchParams = new URLSearchParams(commonParams);
        searchParams.set('q', query);
        response = await fetch(`https://api.klipy.com/v2/search?${searchParams.toString()}`, { signal });
      } else {
        response = await fetch(`https://api.klipy.com/v2/featured?${commonParams.toString()}`, { signal });
        if (!response.ok) {
          const fallbackParams = new URLSearchParams(commonParams);
          fallbackParams.set('q', 'trending');
          response = await fetch(`https://api.klipy.com/v2/search?${fallbackParams.toString()}`, { signal });
        }
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('KLIPY_API_KEY_INVALID');
        }
        const errorCode = await getKlipyErrorCode(response);
        if (errorCode === 'API_KEY_INVALID') {
          throw new Error('KLIPY_API_KEY_INVALID');
        }
        throw new Error(`Klipy request failed (${response.status})`);
      }

      const data = await response.json();
      setGifs(data.results || []);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Error fetching GIFs from Klipy:', error);
      setErrorMessage(error instanceof Error && error.message === 'KLIPY_API_KEY_INVALID'
        ? getKlipySetupMessage()
        : 'Unable to load GIFs right now. Try searching a term or try again in a moment.');
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  // Debounce search — trigger at any length (single chars included), with featured for empty query
  useEffect(() => {
    if (activeTab !== 'search') {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchGifs(searchQuery, controller.signal);
    }, searchQuery.length === 0 ? 0 : 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, searchQuery]);

  const handleSearch = (valueOrEvent: unknown) => {
    if (typeof valueOrEvent === 'string') {
      setSearchQuery(valueOrEvent);
      return;
    }

    if (
      valueOrEvent &&
      typeof valueOrEvent === 'object' &&
      'target' in valueOrEvent &&
      valueOrEvent.target &&
      typeof (valueOrEvent.target as { value?: unknown }).value === 'string'
    ) {
      setSearchQuery((valueOrEvent.target as { value: string }).value);
    }
  };

  const isFavorite = (gif: KlipyGif): boolean => favorites.some((item) => item.id === gif.id);

  const toggleFavorite = (gif: KlipyGif): void => {
    setFavorites((prev) => {
      if (prev.some((item) => item.id === gif.id)) {
        return prev.filter((item) => item.id !== gif.id);
      }
      return upsertGif(prev, gif, MAX_FAVORITES);
    });
  };

  const handleSelect = (gif: KlipyGif): void => {
    setRecents((prev) => upsertGif(prev, gif, MAX_RECENTS));
    onSelect(gif);
  };

  const clearRecents = (): void => {
    setRecents([]);
    setPendingClearTarget(null);
  };

  const clearFavorites = (): void => {
    setFavorites([]);
    setPendingClearTarget(null);
  };

  const reorderFavorite = (sourceId: string, targetId: string): void => {
    setFavorites((prev) => {
      const sourceIndex = prev.findIndex((item) => item.id === sourceId);
      const targetIndex = prev.findIndex((item) => item.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return prev;
      }
      const next = [...prev];
      const removed = next.splice(sourceIndex, 1)[0];
      if (!removed) return prev;
      next.splice(targetIndex, 0, removed);
      return next;
    });
    setDragOverFavoriteId(null);
  };

  const moveFavoriteByOffset = (gifId: string, direction: -1 | 1): void => {
    setFavorites((prev) => {
      const sourceIndex = prev.findIndex((item) => item.id === gifId);
      const targetIndex = sourceIndex + direction;
      if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const removed = next.splice(sourceIndex, 1)[0];
      if (!removed) return prev;
      next.splice(targetIndex, 0, removed);
      return next;
    });
  };

  const requestClear = (target: Exclude<PendingClearTarget, null>): void => {
    setPendingClearTarget(target);
  };

  const confirmClear = (): void => {
    if (pendingClearTarget === 'recents') {
      clearRecents();
      return;
    }
    if (pendingClearTarget === 'favorites') {
      clearFavorites();
    }
  };

  const displayGifs = useMemo(() => {
    if (activeTab === 'recents') return recents;
    if (activeTab === 'favorites') return favorites;
    return gifs;
  }, [activeTab, favorites, gifs, recents]);

  const clearCopy = useMemo(() => {
    if (pendingClearTarget === 'recents') {
      return {
        title: 'Clear recent GIFs?',
        description: 'This removes your recent GIF history from this device.',
        action: clearRecents,
      };
    }
    if (pendingClearTarget === 'favorites') {
      return {
        title: 'Clear favorite GIFs?',
        description: 'This removes all saved favorite GIFs from this device.',
        action: clearFavorites,
      };
    }
    return null;
  }, [pendingClearTarget]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      zIndex: 260,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px 10px',
        borderBottom: '1px solid var(--sep)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 'var(--type-ui-title-sm-size)',
          lineHeight: 'var(--type-ui-title-sm-line)',
          fontWeight: 700,
          color: 'var(--label-1)',
        }}>
          GIF
        </span>
        <button
          onClick={onClose}
          style={{
            fontSize: 'var(--type-label-md-size)',
            lineHeight: 'var(--type-label-md-line)',
            fontWeight: 600,
            color: 'var(--blue)',
            minHeight: 44,
            minWidth: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          }}
        >
          Cancel
        </button>
      </div>

      {/* ── Segmented control tabs ── */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--sep)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
      }}>
        <div style={{
          display: 'flex',
          flex: 1,
          background: 'var(--fill-2)',
          borderRadius: 10,
          padding: 2,
        }}>
          {([
            { id: 'search', label: 'Search' },
            { id: 'recents', label: 'Recents' },
            { id: 'favorites', label: 'Favorites' },
          ] as Array<{ id: GifTab; label: string }>).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: -0.1,
                background: activeTab === tab.id ? 'var(--surface)' : 'transparent',
                color: activeTab === tab.id ? 'var(--label-1)' : 'var(--label-3)',
                boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)' : 'none',
                transition: 'background 0.18s, color 0.18s, box-shadow 0.18s',
                minHeight: 32,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'recents' && recents.length > 0 && (
          <button
            type="button"
            onClick={() => requestClear('recents')}
            style={{
              marginLeft: 10,
              padding: '6px 12px', borderRadius: 8, minHeight: 32,
              fontSize: 13, fontWeight: 600,
              background: 'var(--fill-2)', color: 'var(--label-3)',
            }}
          >
            Clear
          </button>
        )}
        {activeTab === 'favorites' && favorites.length > 0 && (
          <button
            type="button"
            onClick={() => requestClear('favorites')}
            style={{
              marginLeft: 10,
              padding: '6px 12px', borderRadius: 8, minHeight: 32,
              fontSize: 13, fontWeight: 600,
              background: 'var(--fill-2)', color: 'var(--label-3)',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Search field ── */}
      {activeTab === 'search' && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--sep)', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--fill-2)',
            borderRadius: 10, padding: '9px 12px',
          }}>
            <svg
              width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="var(--label-3)"
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search GIFs"
              value={searchQuery}
              onChange={handleSearch}
              autoFocus
              style={{
                flex: 1,
                fontSize: 'var(--type-body-sm-size)',
                lineHeight: 'var(--type-body-sm-line)',
                color: 'var(--label-1)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                minWidth: 0,
              }}
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                style={{
                  width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                  background: 'var(--fill-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--label-2)',
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Favorites hint ── */}
      {activeTab === 'favorites' && favorites.length > 0 && (
        <div style={{
          padding: '6px 16px 8px',
          fontSize: 'var(--type-meta-sm-size)',
          lineHeight: 'var(--type-meta-sm-line)',
          color: 'var(--label-3)',
          borderBottom: '1px solid var(--sep)',
          flexShrink: 0,
        }}>
          Use the arrows to reorder, or drag on desktop.
        </div>
      )}

      {/* ── GIF grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {loading ? (
          /* Skeleton grid — realistic shapes while content loads */
          <div style={{ columns: 2, columnGap: 6 }}>
            {SKELETON_RATIOS.map((ratio, i) => (
              <div
                key={i}
                style={{
                  breakInside: 'avoid',
                  marginBottom: 6,
                  borderRadius: 12,
                  aspectRatio: String(ratio),
                  background: 'var(--fill-2)',
                  opacity: 0.6 + (i % 3) * 0.1,
                }}
              />
            ))}
          </div>
        ) : errorMessage ? (
          <div style={{
            textAlign: 'center', padding: 40,
            fontSize: 'var(--type-body-sm-size)',
            color: 'var(--label-3)',
          }}>
            {errorMessage}
          </div>
        ) : displayGifs.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 40,
            fontSize: 'var(--type-body-sm-size)',
            color: 'var(--label-3)',
          }}>
            {activeTab === 'recents' && 'No recent GIFs yet. Send one and it will appear here.'}
            {activeTab === 'favorites' && 'No favorites yet. Tap the star on a GIF to save it.'}
            {activeTab === 'search' && 'No GIFs found. Try a different search.'}
          </div>
        ) : (
          /* Masonry grid — GIFs keep their natural aspect ratio */
          <div style={{ columns: 2, columnGap: 6 }}>
            {displayGifs.map((gif) => {
              const [w, h] = gif.media_formats.tinygif.dims?.length === 2
                ? gif.media_formats.tinygif.dims
                : [480, 270];
              const favoriteIndex = favorites.findIndex((item) => item.id === gif.id);
              const canMoveEarlier = favoriteIndex > 0;
              const canMoveLater = favoriteIndex !== -1 && favoriteIndex < favorites.length - 1;

              return (
                <div
                  key={gif.id}
                  draggable={activeTab === 'favorites'}
                  onDragStart={(event) => {
                    if (activeTab !== 'favorites') return;
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', gif.id);
                    setDraggingFavoriteId(gif.id);
                  }}
                  onDragOver={(event) => {
                    if (activeTab !== 'favorites' || !draggingFavoriteId || draggingFavoriteId === gif.id) return;
                    event.preventDefault();
                    setDragOverFavoriteId(gif.id);
                  }}
                  onDrop={(event) => {
                    if (activeTab !== 'favorites') return;
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData('text/plain') || draggingFavoriteId;
                    if (sourceId && sourceId !== gif.id) {
                      reorderFavorite(sourceId, gif.id);
                    }
                    setDraggingFavoriteId(null);
                  }}
                  onDragEnd={() => {
                    setDraggingFavoriteId(null);
                    setDragOverFavoriteId(null);
                  }}
                  onClick={() => handleSelect(gif)}
                  style={{
                    breakInside: 'avoid',
                    marginBottom: 6,
                    borderRadius: 12,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    position: 'relative',
                    background: 'var(--fill-1)',
                    aspectRatio: `${w} / ${h}`,
                    opacity: draggingFavoriteId === gif.id ? 0.4 : 1,
                    outline: dragOverFavoriteId === gif.id ? '2px solid var(--blue)' : 'none',
                    outlineOffset: -2,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {/* Favorites reorder controls */}
                  {activeTab === 'favorites' && (
                    <div style={{
                      position: 'absolute', top: 6, left: 6, zIndex: 10,
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 999,
                        background: 'rgba(0,0,0,0.55)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'grab', color: 'white',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                          <circle cx="4" cy="3" r="1.1" />
                          <circle cx="10" cy="3" r="1.1" />
                          <circle cx="4" cy="7" r="1.1" />
                          <circle cx="10" cy="7" r="1.1" />
                          <circle cx="4" cy="11" r="1.1" />
                          <circle cx="10" cy="11" r="1.1" />
                        </svg>
                      </div>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveFavoriteByOffset(gif.id, -1); }}
                          aria-label="Move favorite earlier"
                          disabled={!canMoveEarlier}
                          style={{
                            width: 28, height: 28, borderRadius: 999,
                            background: 'rgba(0,0,0,0.55)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            color: 'white',
                            opacity: canMoveEarlier ? 1 : 0.3,
                            fontSize: 13, cursor: canMoveEarlier ? 'pointer' : 'default',
                          }}
                        >↑</button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveFavoriteByOffset(gif.id, 1); }}
                          aria-label="Move favorite later"
                          disabled={!canMoveLater}
                          style={{
                            width: 28, height: 28, borderRadius: 999,
                            background: 'rgba(0,0,0,0.55)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            color: 'white',
                            opacity: canMoveLater ? 1 : 0.3,
                            fontSize: 13, cursor: canMoveLater ? 'pointer' : 'default',
                          }}
                        >↓</button>
                      </div>
                    </div>
                  )}

                  {/* Favorite star toggle */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(gif); }}
                    aria-label={isFavorite(gif) ? 'Remove from favorites' : 'Add to favorites'}
                    style={{
                      position: 'absolute', top: 6, right: 6, zIndex: 10,
                      width: 28, height: 28, borderRadius: 999,
                      background: 'rgba(0,0,0,0.55)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      color: isFavorite(gif) ? '#FFD60A' : 'white',
                      fontSize: 14,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'color 0.15s',
                    }}
                  >
                    {isFavorite(gif) ? '★' : '☆'}
                  </button>

                  <img
                    src={gif.media_formats.tinygif.url || gif.media_formats.gif.url}
                    alt={gif.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    loading="lazy"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer attribution ── */}
      <div style={{
        textAlign: 'center',
        padding: '6px 16px calc(6px + var(--safe-bottom, 0px))',
        fontSize: 'var(--type-meta-sm-size)',
        lineHeight: 'var(--type-meta-sm-line)',
        color: 'var(--label-4)',
        borderTop: '1px solid var(--sep)',
        flexShrink: 0,
      }}>
        Powered by KLIPY
      </div>

      {/* ── Clear confirmation sheet ── */}
      <AnimatePresence>
        {clearCopy && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPendingClearTarget(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 261 }}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              style={{
                position: 'fixed',
                left: 16, right: 16,
                bottom: 'calc(var(--safe-bottom, 0px) + 16px)',
                zIndex: 262,
                background: 'var(--surface)',
                borderRadius: 16,
                border: '1px solid var(--sep)',
                boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '16px', borderBottom: '1px solid var(--sep)' }}>
                <div style={{
                  fontSize: 'var(--type-label-lg-size)',
                  lineHeight: 'var(--type-label-lg-line)',
                  fontWeight: 700, color: 'var(--label-1)',
                }}>
                  {clearCopy.title}
                </div>
                <div style={{
                  fontSize: 'var(--type-meta-md-size)',
                  lineHeight: 'var(--type-meta-md-line)',
                  color: 'var(--label-3)', marginTop: 4,
                }}>
                  {clearCopy.description}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '12px 16px' }}>
                <button
                  type="button"
                  onClick={() => setPendingClearTarget(null)}
                  style={{
                    border: '1px solid var(--sep)',
                    background: 'var(--surface)',
                    color: 'var(--label-2)',
                    fontSize: 'var(--type-label-md-size)',
                    lineHeight: 'var(--type-label-md-line)',
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: '9px 16px',
                    minHeight: 38,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmClear}
                  style={{
                    border: 'none',
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: 'var(--type-label-md-size)',
                    lineHeight: 'var(--type-label-md-line)',
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: '9px 16px',
                    minHeight: 38,
                  }}
                >
                  Clear
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
