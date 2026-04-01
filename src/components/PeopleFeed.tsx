import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { atpCall } from '../lib/atproto/client';
import type { AppBskyActorDefs } from '@atproto/api';
import { normalizeAtprotoSearchQuery } from '../lib/searchQuery';
import { mergePeopleCandidates, searchSemanticPeople } from '../lib/semanticPeople';
import { useProfileNavigation } from '../hooks/useProfileNavigation';
import { useAppearanceStore } from '../store/appearanceStore';
import { actorLabelChips } from '../lib/atproto/labelPresentation';
import {
  discovery as disc,
  accent,
  type as typeScale,
} from '../design/index';

function PeopleFeed({ query }: { query: string }) {
  const { agent, sessionReady } = useSessionStore();
  const closePeopleFeed = useUiStore((state) => state.closePeopleFeed);
  const navigateToProfile = useProfileNavigation();
  const showProvenanceChips = useAppearanceStore((state) => state.showProvenanceChips);
  const showAtprotoLabelChips = useAppearanceStore((state) => state.showAtprotoLabelChips);

  const [actors, setActors] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchSort, setSearchSort] = useState<'top' | 'latest'>('top');
  const [actorCursor, setActorCursor] = useState<string | null>(null);
  const [hasMoreActors, setHasMoreActors] = useState(false);
  const [loadingMoreActors, setLoadingMoreActors] = useState(false);
  const [semanticActorDids, setSemanticActorDids] = useState<Set<string>>(new Set());
  const [keywordActorDids, setKeywordActorDids] = useState<Set<string>>(new Set());
  const requestVersionRef = useRef(0);

  const normalizedQuery = useMemo(() => normalizeAtprotoSearchQuery(query), [query]);

  const dedupeActors = useCallback((actorList: AppBskyActorDefs.ProfileView[]): AppBskyActorDefs.ProfileView[] => {
    const seen = new Set<string>();
    return actorList.filter((actor) => {
      const key = actor.did.trim().toLowerCase();
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!sessionReady) return;
    if (!normalizedQuery.trim()) return;

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let disposed = false;

    setLoading(true);
    setActors([]);
    setActorCursor(null);
    setHasMoreActors(false);
    setSemanticActorDids(new Set());
    setKeywordActorDids(new Set());

    Promise.all([
      atpCall(() => agent.searchActors({ q: normalizedQuery, limit: 50 })).catch(() => null),
      searchSemanticPeople(agent, normalizedQuery, { rowLimit: 48, maxProfiles: 14 }).catch(() => []),
    ])
      .then(([res, semanticActors]: [any, AppBskyActorDefs.ProfileView[]]) => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        const keywordActors = res?.data?.actors ?? [];
        setSemanticActorDids(new Set(semanticActors.map((actor) => actor.did.trim().toLowerCase())));
        setKeywordActorDids(new Set(keywordActors.map((actor: AppBskyActorDefs.ProfileView) => actor.did.trim().toLowerCase())));
        const merged = searchSort === 'top'
          ? mergePeopleCandidates(semanticActors, keywordActors)
          : mergePeopleCandidates(keywordActors, semanticActors);

        setActors(dedupeActors(merged));
        setActorCursor(res?.data?.cursor ?? null);
        setHasMoreActors(Boolean(res?.data?.cursor));
      })
      .catch(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setActors([]);
        setHasMoreActors(false);
      })
      .finally(() => {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [sessionReady, normalizedQuery, agent, dedupeActors, searchSort]);

  // Load more
  const loadMoreActors = useCallback(() => {
    if (!sessionReady || loadingMoreActors || !actorCursor) return;

    const requestVersion = requestVersionRef.current;

    setLoadingMoreActors(true);

    atpCall(() => agent.searchActors({ q: normalizedQuery, limit: 50, cursor: actorCursor }))
      .then((res) => {
        if (requestVersion !== requestVersionRef.current) return;
        if (res?.data?.actors) {
          const nextActors = res.data.actors;
          setActors((prev) => dedupeActors([...prev, ...nextActors]));
          setKeywordActorDids((prev) => {
            const next = new Set(prev);
            nextActors.forEach((actor: AppBskyActorDefs.ProfileView) => {
              next.add(actor.did.trim().toLowerCase());
            });
            return next;
          });
          setActorCursor(res.data.cursor ?? null);
          setHasMoreActors(Boolean(res.data.cursor));
        }
      })
      .catch(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setHasMoreActors(false);
      })
      .finally(() => {
        if (requestVersion !== requestVersionRef.current) return;
        setLoadingMoreActors(false);
      });
  }, [sessionReady, normalizedQuery, agent, loadingMoreActors, actorCursor, dedupeActors]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: disc.bgBase,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 200,
      }}
    >
      {/* Atmosphere */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: disc.bgAtmosphere }} />

      {/* Top bar */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flexShrink: 0,
          paddingTop: 'calc(var(--safe-top) + 12px)',
          padding: 'calc(var(--safe-top) + 12px) 20px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          onClick={closePeopleFeed}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: disc.surfaceCard,
            border: `0.5px solid ${disc.lineSubtle}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={disc.textSecondary}
            strokeWidth={2.5}
            strokeLinecap="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p
          style={{
            flex: 1,
            fontSize: typeScale.titleSm[0],
            fontWeight: typeScale.titleSm[2],
            letterSpacing: typeScale.titleSm[3],
            color: disc.textPrimary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          People: {query}
        </p>
      </div>

      {/* Controls */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '0 20px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setSearchSort('top')}
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            background: searchSort === 'top' ? accent.primary : disc.surfaceCard,
            color: searchSort === 'top' ? '#fff' : disc.textSecondary,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Top
        </button>
        <button
          type="button"
          onClick={() => setSearchSort('latest')}
          style={{
            border: 'none',
            borderRadius: 999,
            padding: '6px 12px',
            cursor: 'pointer',
            background: searchSort === 'latest' ? accent.primary : disc.surfaceCard,
            color: searchSort === 'latest' ? '#fff' : disc.textSecondary,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Recent
        </button>
      </div>

      {/* Feed */}
      <div className="scroll-y" style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke={disc.textTertiary}
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 12 12"
                  to="360 12 12"
                  dur="0.8s"
                  repeatCount="indefinite"
                />
              </path>
            </svg>
          </div>
        ) : actors.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: 20,
              textAlign: 'center',
            }}
          >
            <p style={{ fontSize: typeScale.bodyMd[0], color: disc.textSecondary }}>
              No people found matching that search
            </p>
          </div>
        ) : (
          <div style={{ padding: '10px 0' }}>
            {actors.map((actor) => (
              (() => {
                const didKey = actor.did.trim().toLowerCase();
                const isSemanticMatch = semanticActorDids.has(didKey);
                const isKeywordMatch = keywordActorDids.has(didKey);
                const isFollowing = Boolean(actor.viewer?.following);
                const followedBy = Boolean(actor.viewer?.followedBy);
                const isMutual = isFollowing && followedBy;
                const isMuted = Boolean(actor.viewer?.muted);
                const isBlocking = Boolean(actor.viewer?.blocking);
                const isBlockedBy = Boolean(actor.viewer?.blockedBy);
                const labels = showAtprotoLabelChips
                  ? actorLabelChips({ labels: (actor as any).labels, actorDid: actor.did, maxChips: 3 })
                  : [];

                const chipStyleByTone: Record<'neutral' | 'warning' | 'danger' | 'info', React.CSSProperties> = {
                  neutral: { background: disc.surfaceFocus, color: disc.textSecondary },
                  warning: { background: 'rgba(255,149,0,0.18)', color: '#ffb454' },
                  danger: { background: 'rgba(255,77,79,0.18)', color: '#ff7b7d' },
                  info: { background: 'rgba(124,233,255,0.2)', color: accent.cyan400 },
                };

                return (
              <button
                key={actor.did}
                onClick={() => navigateToProfile(actor.handle)}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  borderBottom: `0.5px solid ${disc.lineSubtle}`,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = disc.surfaceFocus)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: actor.avatar
                      ? `url(${actor.avatar})`
                      : disc.surfaceCard,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    flexShrink: 0,
                    border: `0.5px solid ${disc.lineSubtle}`,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }}>
                      {actor.displayName || actor.handle}
                    </span>
                  </div>
                  <p style={{ fontSize: typeScale.metaSm[0], color: disc.textTertiary, margin: 0, marginBottom: 6 }}>
                    @{actor.handle}
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: actor.description ? 6 : 0 }}>
                    {isMutual && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(91,124,255,0.15)', color: accent.primary }}>
                        Mutual
                      </span>
                    )}
                    {!isMutual && isFollowing && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: disc.surfaceFocus, color: disc.textSecondary }}>
                        Following
                      </span>
                    )}
                    {!isMutual && followedBy && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.16)', color: accent.cyan400 }}>
                        Follows you
                      </span>
                    )}
                    {isMuted && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,149,0,0.18)', color: '#ffb454' }}>
                        Muted
                      </span>
                    )}
                    {isBlocking && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,77,79,0.18)', color: '#ff7b7d' }}>
                        Blocked
                      </span>
                    )}
                    {isBlockedBy && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(255,77,79,0.12)', color: '#ff9d9e' }}>
                        Blocks you
                      </span>
                    )}
                    {showProvenanceChips && isSemanticMatch && isKeywordMatch && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.2)', color: accent.cyan400 }}>
                        Semantic + keyword
                      </span>
                    )}
                    {showProvenanceChips && isSemanticMatch && !isKeywordMatch && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: 'rgba(124,233,255,0.2)', color: accent.cyan400 }}>
                        Semantic match
                      </span>
                    )}
                    {showProvenanceChips && !isSemanticMatch && isKeywordMatch && (
                      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: disc.surfaceFocus, color: disc.textSecondary }}>
                        Keyword match
                      </span>
                    )}
                    {labels.map((label) => (
                      <span
                        key={label.key}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: '2px 8px',
                          ...chipStyleByTone[label.tone],
                        }}
                      >
                        {label.text}
                      </span>
                    ))}
                  </div>
                  {actor.description && (
                    <p
                      style={{
                        fontSize: typeScale.bodySm[0],
                        color: disc.textSecondary,
                        margin: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {actor.description}
                    </p>
                  )}
                </div>
              </button>
                );
              })()
            ))}

            {hasMoreActors && (
              <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={loadMoreActors}
                  disabled={loadingMoreActors}
                  style={{
                    border: 'none',
                    borderRadius: 999,
                    padding: '8px 16px',
                    cursor: loadingMoreActors ? 'default' : 'pointer',
                    background: loadingMoreActors ? disc.surfaceFocus : 'rgba(124,233,255,0.18)',
                    color: disc.textPrimary,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {loadingMoreActors ? 'Loading…' : 'Load more people'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default PeopleFeed;
