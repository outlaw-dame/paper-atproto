import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { useUiStore } from '../store/uiStore';
import { atpCall } from '../lib/atproto/client';
import { mapPostViewToMockPost, hasDisplayableRecordContent } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import { normalizeAtprotoSearchQuery } from '../lib/searchQuery';
import { mapHybridPostRowToMockPost } from '../lib/exploreSearchResults';
import { hybridSearch } from '../search';
import { usePostFilterResults } from '../lib/contentFilters/usePostFilterResults';
import { useTranslationStore } from '../store/translationStore';
import {
  discovery as disc,
  accent,
  type as typeScale,
  radius,
} from '../design/index';

function HashtagFeed({ hashtag }: { hashtag: string }) {
  const { agent, sessionReady } = useSessionStore();
  const closeHashtagFeed = useUiStore((state) => state.closeHashtagFeed);
  const { byId: translationById } = useTranslationStore();

  const [posts, setPosts] = useState<MockPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchSort, setSearchSort] = useState<'top' | 'latest'>('top');
  const [postCursor, setPostCursor] = useState<string | null>(null);
  const [tagPostCursor, setTagPostCursor] = useState<string | null>(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const requestVersionRef = useRef(0);

  const normalizedQuery = useMemo(() => normalizeAtprotoSearchQuery(hashtag), [hashtag]);
  const plainTextQuery = useMemo(() => hashtag.replace(/^#/, ''), [hashtag]);

  // Helper to dedupe posts by ID
  const dedupePosts = useCallback((postList: MockPost[]): MockPost[] => {
    const seen = new Set<string>();
    return postList.filter((post) => {
      const key = post.id.trim().toLowerCase();
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
    setPosts([]);
    setPostCursor(null);
    setTagPostCursor(null);
    setHasMorePosts(false);

    Promise.all([
      // Tag search (e.g., posts tagged with #Apple)
      atpCall(() => (agent.app.bsky.feed as any).searchPosts({ tag: normalizedQuery, sort: searchSort, limit: 40 })).catch(() => null),
      // Plain text search (e.g., posts mentioning "Apple")
      atpCall(() => agent.app.bsky.feed.searchPosts({ q: plainTextQuery, sort: searchSort, limit: 40 })).catch(() => null),
      // Semantic/hybrid search on plain text
      hybridSearch.search(plainTextQuery, 30).catch(() => null),
    ]).then(([tagRes, plainRes, hybridRes]: [any, any, any]) => {
      if (disposed || requestVersion !== requestVersionRef.current) return;
      const allPosts: MockPost[] = [];

      // Add tag search results
      if (tagRes?.data?.posts?.length) {
        const tagPosts = tagRes.data.posts
          .filter((p: any) => hasDisplayableRecordContent(p?.record))
          .map((p: any) => mapPostViewToMockPost(p));
        allPosts.push(...tagPosts);
      }

      // Add plain text search results (different from tag results)
      if (plainRes?.data?.posts?.length) {
        const plainPosts = plainRes.data.posts
          .filter((p: any) => hasDisplayableRecordContent(p?.record))
          .map((p: any) => mapPostViewToMockPost(p));
        allPosts.push(...plainPosts);
      }

      // Add hybrid/semantic search results
      if (hybridRes?.rows?.length) {
        const hybridPosts = hybridRes.rows.map((row: any) => mapHybridPostRowToMockPost(row));
        allPosts.push(...hybridPosts);
      }

      // Dedupe all results
      const deduped = dedupePosts(allPosts);
      setPosts(deduped);

      setPostCursor(tagRes?.data?.cursor ?? null);
      setTagPostCursor(plainRes?.data?.cursor ?? null);
      setHasMorePosts(Boolean(tagRes?.data?.cursor || plainRes?.data?.cursor));
    }).catch(() => {
      if (disposed || requestVersion !== requestVersionRef.current) return;
      setPosts([]);
      setHasMorePosts(false);
    }).finally(() => {
      if (disposed || requestVersion !== requestVersionRef.current) return;
      setLoading(false);
    });

    return () => {
      disposed = true;
    };
  }, [sessionReady, normalizedQuery, plainTextQuery, searchSort, agent, dedupePosts]);

  // Load more
  const loadMorePosts = useCallback(() => {
    if (!sessionReady || loadingMorePosts || (!postCursor && !tagPostCursor)) return;

    const requestVersion = requestVersionRef.current;

    setLoadingMorePosts(true);

    Promise.all([
      postCursor
        ? atpCall(() => (agent.app.bsky.feed as any).searchPosts({ tag: normalizedQuery, sort: searchSort, limit: 30, cursor: postCursor })).catch(() => null)
        : Promise.resolve(null),
      tagPostCursor
        ? atpCall(() => agent.app.bsky.feed.searchPosts({ q: plainTextQuery, sort: searchSort, limit: 30, cursor: tagPostCursor })).catch(() => null)
        : Promise.resolve(null),
    ]).then(([tagRes, plainRes]: [any, any]) => {
      if (requestVersion !== requestVersionRef.current) return;
      const nextPosts: MockPost[] = [];

      if (tagRes?.data?.posts?.length) {
        const tagPosts = tagRes.data.posts
          .filter((p: any) => hasDisplayableRecordContent(p?.record))
          .map((p: any) => mapPostViewToMockPost(p));
        nextPosts.push(...tagPosts);
      }

      if (plainRes?.data?.posts?.length) {
        const plainPosts = plainRes.data.posts
          .filter((p: any) => hasDisplayableRecordContent(p?.record))
          .map((p: any) => mapPostViewToMockPost(p));
        nextPosts.push(...plainPosts);
      }

      setPosts((prev) => dedupePosts([...prev, ...nextPosts]));
      setPostCursor(tagRes?.data?.cursor ?? null);
      setTagPostCursor(plainRes?.data?.cursor ?? null);
      setHasMorePosts(Boolean(tagRes?.data?.cursor || plainRes?.data?.cursor));
    }).catch(() => {
      if (requestVersion !== requestVersionRef.current) return;
      setHasMorePosts(false);
    }).finally(() => {
      if (requestVersion !== requestVersionRef.current) return;
      setLoadingMorePosts(false);
    });
  }, [sessionReady, normalizedQuery, plainTextQuery, searchSort, agent, loadingMorePosts, postCursor, tagPostCursor, dedupePosts]);

  const filterResults = usePostFilterResults(posts, 'explore');
  const visiblePosts = useMemo(
    () => posts.filter((post) => !(filterResults[post.id] ?? []).some((m) => m.action === 'hide')),
    [posts, filterResults],
  );

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
          onClick={closeHashtagFeed}
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
          {hashtag}
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
          Latest
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
        ) : visiblePosts.length === 0 ? (
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
              No posts found for {hashtag}
            </p>
          </div>
        ) : (
          <div style={{ padding: '10px 0' }}>
            {visiblePosts.map((post) => (
              <div
                key={post.id}
                style={{
                  padding: '12px 20px',
                  borderBottom: `0.5px solid ${disc.lineSubtle}`,
                  display: 'flex',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: disc.surfaceCard,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: typeScale.bodySm[0], fontWeight: 700, color: disc.textPrimary }}>
                      {post.author.displayName || post.author.handle}
                    </span>
                    <span style={{ fontSize: typeScale.bodySm[0], color: disc.textTertiary }}>
                      @{post.author.handle}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: typeScale.bodySm[0],
                      color: disc.textSecondary,
                      wordWrap: 'break-word',
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                      marginBottom: 8,
                    }}
                  >
                    {translationById[post.id]?.translatedText ?? post.content}
                  </p>
                  <div style={{ display: 'flex', gap: 16, fontSize: typeScale.metaSm[0], color: disc.textTertiary }}>
                    <span>💬 {post.replyCount}</span>
                    <span>❤️ {post.likeCount}</span>
                    <span>🔄 {post.repostCount}</span>
                  </div>
                </div>
              </div>
            ))}

            {hasMorePosts && (
              <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={loadMorePosts}
                  disabled={loadingMorePosts}
                  style={{
                    border: 'none',
                    borderRadius: 999,
                    padding: '8px 16px',
                    cursor: loadingMorePosts ? 'default' : 'pointer',
                    background: loadingMorePosts ? disc.surfaceFocus : 'rgba(124,233,255,0.18)',
                    color: disc.textPrimary,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {loadingMorePosts ? 'Loading…' : 'Load more posts'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default HashtagFeed;
