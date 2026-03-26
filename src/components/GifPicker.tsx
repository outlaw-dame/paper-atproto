import React, { useMemo, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface TenorGif {
  id: string;
  title: string;
  media_formats: {
    tinygif: { url: string; dims: [number, number]; size: number };
    gif: { url: string; dims: [number, number]; size: number };
  };
  url: string;
}

interface GifPickerProps {
  onSelect: (gif: TenorGif) => void;
  onClose: () => void;
}

const TENOR_API_KEY = (import.meta.env.VITE_TENOR_API_KEY || '').trim();
const RAW_CLIENT_KEY = (import.meta.env.VITE_TENOR_CLIENT_KEY || 'paper-atproto').trim();
const CLIENT_KEY = RAW_CLIENT_KEY.replace(/[^a-zA-Z0-9_]/g, '_') || 'paper_atproto';
const TENOR_API_KEY_PLACEHOLDERS = new Set(['', 'your_tenor_api_key_here', 'LIVDSRZULELA']);
const RECENTS_KEY = 'paper.gifpicker.recents';
const FAVORITES_KEY = 'paper.gifpicker.favorites';
const MAX_RECENTS = 30;
const MAX_FAVORITES = 80;

type GifTab = 'search' | 'recents' | 'favorites';
type PendingClearTarget = GifTab | null;

function isValidGif(value: unknown): value is TenorGif {
  if (!value || typeof value !== 'object') return false;
  const gif = value as Partial<TenorGif>;
  return typeof gif.id === 'string' && !!gif.media_formats?.tinygif?.url;
}

function readStoredGifs(key: string): TenorGif[] {
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

function writeStoredGifs(key: string, gifs: TenorGif[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(gifs));
  } catch {
    // Ignore storage failures (private mode, quota limits, etc).
  }
}

function upsertGif(list: TenorGif[], gif: TenorGif, maxSize: number): TenorGif[] {
  const next = [gif, ...list.filter((item) => item.id !== gif.id)];
  return next.slice(0, maxSize);
}

function isTenorConfigured(): boolean {
  return !TENOR_API_KEY_PLACEHOLDERS.has(TENOR_API_KEY);
}

function getTenorSetupMessage(): string {
  return 'GIF search needs a valid Tenor API key. Set VITE_TENOR_API_KEY in your .env file and reload the app.';
}

async function getTenorErrorCode(response: Response): Promise<string | null> {
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

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect, onClose }) => {
  const [activeTab, setActiveTab] = useState<GifTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [recents, setRecents] = useState<TenorGif[]>(() => readStoredGifs(RECENTS_KEY));
  const [favorites, setFavorites] = useState<TenorGif[]>(() => readStoredGifs(FAVORITES_KEY));
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
    if (!isTenorConfigured()) {
      setLoading(false);
      setGifs([]);
      setErrorMessage(getTenorSetupMessage());
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const commonParams = new URLSearchParams({
        key: TENOR_API_KEY,
        client_key: CLIENT_KEY,
        limit: '20',
        media_filter: 'tinygif,gif',
      });

      let response: Response;
      if (query) {
        const searchParams = new URLSearchParams(commonParams);
        searchParams.set('q', query);
        response = await fetch(`https://tenor.googleapis.com/v2/search?${searchParams.toString()}`, { signal });
      } else {
        response = await fetch(`https://tenor.googleapis.com/v2/featured?${commonParams.toString()}`, { signal });
        if (!response.ok) {
          const fallbackParams = new URLSearchParams(commonParams);
          fallbackParams.set('q', 'trending');
          response = await fetch(`https://tenor.googleapis.com/v2/search?${fallbackParams.toString()}`, { signal });
        }
      }

      if (!response.ok) {
        const errorCode = await getTenorErrorCode(response);
        if (errorCode === 'API_KEY_INVALID') {
          throw new Error('TENOR_API_KEY_INVALID');
        }
        throw new Error(`Tenor request failed (${response.status})`);
      }

      const data = await response.json();
      setGifs(data.results || []);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Error fetching GIFs from Tenor:', error);
      setErrorMessage(error instanceof Error && error.message === 'TENOR_API_KEY_INVALID'
        ? getTenorSetupMessage()
        : 'Unable to load GIFs right now. Try searching a term or try again in a moment.');
      setGifs([]);
    } finally {
      setLoading(false);
    }
  };

  // Debounce search to avoid excessive API calls
  useEffect(() => {
    if (activeTab !== 'search') {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (searchQuery.length > 2 || searchQuery.length === 0) {
        void fetchGifs(searchQuery, controller.signal);
      }
    }, 500);
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

  const isFavorite = (gif: TenorGif): boolean => favorites.some((item) => item.id === gif.id);

  const toggleFavorite = (gif: TenorGif): void => {
    setFavorites((prev) => {
      if (prev.some((item) => item.id === gif.id)) {
        return prev.filter((item) => item.id !== gif.id);
      }
      return upsertGif(prev, gif, MAX_FAVORITES);
    });
  };

  const handleSelect = (gif: TenorGif): void => {
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
          Select a GIF
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

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        borderBottom: '1px solid var(--sep)',
        flexShrink: 0,
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
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 'var(--type-label-md-size)',
              lineHeight: 'var(--type-label-md-line)',
              fontWeight: 600,
              background: activeTab === tab.id ? 'var(--blue)' : 'var(--fill-2)',
              color: activeTab === tab.id ? '#fff' : 'var(--label-2)',
              transition: 'background 0.15s, color 0.15s',
              minHeight: 32,
            }}
          >
            {tab.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {activeTab === 'recents' && recents.length > 0 && (
          <button
            type="button"
            onClick={() => requestClear('recents')}
            style={{
              padding: '6px 14px', borderRadius: 999, minHeight: 32,
              fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)',
              fontWeight: 600, background: 'var(--fill-2)', color: 'var(--label-2)',
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
              padding: '6px 14px', borderRadius: 999, minHeight: 32,
              fontSize: 'var(--type-label-md-size)', lineHeight: 'var(--type-label-md-line)',
              fontWeight: 600, background: 'var(--fill-2)', color: 'var(--label-2)',
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
            {/* Decorative leading search icon — not interactive */}
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
              placeholder="Search Tenor"
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

      {/* ── Favorites drag hint ── */}
      {activeTab === 'favorites' && favorites.length > 0 && (
        <div style={{
          padding: '8px 16px',
          fontSize: 'var(--type-meta-sm-size)',
          lineHeight: 'var(--type-meta-sm-line)',
          color: 'var(--label-3)',
          borderBottom: '1px solid var(--sep)',
          flexShrink: 0,
        }}>
          Drag to reorder, or use the move buttons on each GIF.
        </div>
      )}

      {/* ── GIF grid ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loading ? (
          <div style={{
            textAlign: 'center', padding: 40,
            fontSize: 'var(--type-body-sm-size)',
            color: 'var(--label-3)',
          }}>
            Loading GIFs…
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
            {activeTab === 'search' && (
              searchQuery.length > 0 && searchQuery.length <= 2
                ? 'Keep typing to search…'
                : 'No GIFs found. Try a different search.'
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {displayGifs.map((gif) => {
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
                    aspectRatio: '1',
                    overflow: 'hidden',
                    borderRadius: 12,
                    cursor: 'pointer',
                    position: 'relative',
                    background: 'var(--fill-1)',
                    opacity: draggingFavoriteId === gif.id ? 0.5 : 1,
                    outline: dragOverFavoriteId === gif.id ? '2px solid var(--blue)' : 'none',
                    outlineOffset: -2,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {/* Favorites reorder controls */}
                  {activeTab === 'favorites' && (
                    <div style={{
                      position: 'absolute', top: 8, left: 8, zIndex: 10,
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 999,
                        background: 'rgba(0,0,0,0.55)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'grab', color: 'white',
                      }}>
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                          <circle cx="4" cy="3" r="1.1" />
                          <circle cx="10" cy="3" r="1.1" />
                          <circle cx="4" cy="7" r="1.1" />
                          <circle cx="10" cy="7" r="1.1" />
                          <circle cx="4" cy="11" r="1.1" />
                          <circle cx="10" cy="11" r="1.1" />
                        </svg>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveFavoriteByOffset(gif.id, -1); }}
                          aria-label="Move favorite earlier"
                          disabled={!canMoveEarlier}
                          style={{
                            width: 30, height: 30, borderRadius: 999,
                            background: 'rgba(0,0,0,0.55)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            color: 'white',
                            opacity: canMoveEarlier ? 1 : 0.35,
                            fontSize: 14, cursor: 'pointer',
                          }}
                        >↑</button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveFavoriteByOffset(gif.id, 1); }}
                          aria-label="Move favorite later"
                          disabled={!canMoveLater}
                          style={{
                            width: 30, height: 30, borderRadius: 999,
                            background: 'rgba(0,0,0,0.55)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            color: 'white',
                            opacity: canMoveLater ? 1 : 0.35,
                            fontSize: 14, cursor: 'pointer',
                          }}
                        >↓</button>
                      </div>
                    </div>
                  )}

                  {/* Favorite toggle */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(gif); }}
                    aria-label={isFavorite(gif) ? 'Remove from favorites' : 'Add to favorites'}
                    style={{
                      position: 'absolute', top: 8, right: 8, zIndex: 10,
                      width: 30, height: 30, borderRadius: 999,
                      background: 'rgba(0,0,0,0.55)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      color: 'white', fontSize: 14,
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

      {/* ── Footer ── */}
      <div style={{
        textAlign: 'center',
        padding: '8px 16px calc(8px + var(--safe-bottom, 0px))',
        fontSize: 'var(--type-meta-sm-size)',
        lineHeight: 'var(--type-meta-sm-line)',
        color: 'var(--label-4)',
        borderTop: '1px solid var(--sep)',
        flexShrink: 0,
      }}>
        Powered by Tenor
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
