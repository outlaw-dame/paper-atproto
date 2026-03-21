import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PostCard from '../components/PostCard';
import { useAtp } from '../atproto/AtpContext';
import { mapFeedViewPost } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import type { AppBskyActorDefs, AppBskyFeedDefs } from '@atproto/api';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-3)', letterSpacing: 0.5, textTransform: 'uppercase', padding: '16px 16px 8px' }}>
      {title}
    </p>
  );
}

// ─── Actor (people) search result row ─────────────────────────────────────
function ActorRow({ actor, onFollow }: { actor: AppBskyActorDefs.ProfileView; onFollow: (did: string) => void }) {
  const [following, setFollowing] = useState(actor.viewer?.following !== undefined);
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '0.5px solid var(--sep)' }}>
      <div style={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
        {actor.avatar
          ? <img src={actor.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--indigo)', color: '#fff', fontSize: 16, fontWeight: 700 }}>{(actor.displayName ?? actor.handle)[0]}</div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {actor.displayName ?? actor.handle}
        </p>
        <p style={{ fontSize: 13, color: 'var(--label-3)' }}>@{actor.handle}</p>
        {actor.description && (
          <p style={{ fontSize: 12, color: 'var(--label-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {actor.description}
          </p>
        )}
      </div>
      <button
        onClick={() => { setFollowing(v => !v); onFollow(actor.did); }}
        style={{
          padding: '6px 14px', borderRadius: 100, flexShrink: 0,
          background: following ? 'var(--fill-2)' : 'var(--blue)',
          color: following ? 'var(--label-1)' : '#fff',
          fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

// ─── Feed generator card ───────────────────────────────────────────────────
function FeedCard({ gen }: { gen: AppBskyFeedDefs.GeneratorView }) {
  const [following, setFollowing] = useState(gen.viewer?.like !== undefined);
  return (
    <div style={{
      flexShrink: 0, width: 148,
      background: 'var(--surface)', borderRadius: 16,
      padding: '14px 14px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, overflow: 'hidden', background: 'var(--fill-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {gen.avatar
          ? <img src={gen.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 22 }}>⚡</span>
        }
      </div>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', letterSpacing: -0.2, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gen.displayName}</p>
        <p style={{ fontSize: 12, color: 'var(--label-3)' }}>by @{gen.creator.handle.replace('.bsky.social', '')}</p>
      </div>
      <p style={{ fontSize: 12, color: 'var(--label-2)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {gen.description ?? 'Custom feed'}
      </p>
      <button
        onClick={() => setFollowing(v => !v)}
        style={{
          padding: '7px 0', borderRadius: 8,
          background: following ? 'var(--fill-2)' : 'var(--blue)',
          color: following ? 'var(--label-1)' : '#fff',
          fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
      >
        {following ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ExploreTab({ onOpenStory }: Props) {
  const { agent } = useAtp();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchPosts, setSearchPosts] = useState<MockPost[]>([]);
  const [searchActors, setSearchActors] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [suggestedFeeds, setSuggestedFeeds] = useState<AppBskyFeedDefs.GeneratorView[]>([]);
  const [suggestedActors, setSuggestedActors] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // Live search
  useEffect(() => {
    if (!debouncedQuery.trim()) { setSearchPosts([]); setSearchActors([]); return; }
    if (!agent.session) return;
    setLoading(true);
    Promise.all([
      agent.app.bsky.feed.searchPosts({ q: debouncedQuery, limit: 20 }).catch(() => null),
      agent.searchActors({ term: debouncedQuery, limit: 8 }).catch(() => null),
    ]).then(([postsRes, actorsRes]) => {
      if (postsRes?.data?.posts) {
        setSearchPosts(
          postsRes.data.posts
            .filter((p: any) => p?.record?.text)
            .map((p: any) => mapFeedViewPost({ post: p, reply: undefined, reason: undefined }))
        );
      }
      if (actorsRes?.data?.actors) {
        setSearchActors(actorsRes.data.actors);
      }
    }).finally(() => setLoading(false));
  }, [debouncedQuery, agent]);

  // Load discovery content on mount
  useEffect(() => {
    if (!agent.session) return;
    setDiscoverLoading(true);
    Promise.all([
      agent.app.bsky.feed.getSuggestedFeeds({ limit: 10 }).catch(() => null),
      agent.getSuggestions({ limit: 10 }).catch(() => null),
    ]).then(([feedsRes, actorsRes]) => {
      if (feedsRes?.data?.feeds) setSuggestedFeeds(feedsRes.data.feeds);
      if (actorsRes?.data?.actors) setSuggestedActors(actorsRes.data.actors);
    }).finally(() => setDiscoverLoading(false));
  }, [agent]);

  const handleFollow = useCallback(async (did: string) => {
    if (!agent.session) return;
    try { await agent.follow(did); } catch { /* ignore */ }
  }, [agent]);

  const isSearching = debouncedQuery.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Search bar */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 16px 12px',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
            background: 'var(--fill-2)', borderRadius: 12, padding: '9px 12px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search people, topics, posts…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex: 1, fontSize: 15, color: 'var(--label-1)', background: 'none', border: 'none', outline: 'none' }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ color: 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.blur(); }} style={{ fontSize: 15, color: 'var(--blue)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="scroll-y" style={{ flex: 1 }}>
        <AnimatePresence mode="wait">
          {isSearching ? (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {loading ? (
                <Spinner />
              ) : (
                <>
                  {searchActors.length > 0 && (
                    <>
                      <SectionHeader title="People" />
                      <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
                        {searchActors.map(actor => (
                          <ActorRow key={actor.did} actor={actor} onFollow={handleFollow} />
                        ))}
                      </div>
                    </>
                  )}
                  {searchPosts.length > 0 && (
                    <>
                      <SectionHeader title="Posts" />
                      <div style={{ padding: '0 12px' }}>
                        {searchPosts.map((post, i) => (
                          <PostCard key={post.id} post={post} onOpenStory={onOpenStory} index={i} />
                        ))}
                      </div>
                    </>
                  )}
                  {searchActors.length === 0 && searchPosts.length === 0 && (
                    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                      <p style={{ fontSize: 15, color: 'var(--label-3)' }}>No results for "{debouncedQuery}"</p>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {discoverLoading ? (
                <Spinner />
              ) : (
                <>
                  {/* Suggested feeds */}
                  {suggestedFeeds.length > 0 && (
                    <>
                      <SectionHeader title="Feeds to Follow" />
                      <div className="scroll-x" style={{ display: 'flex', flexDirection: 'row', gap: 10, padding: '0 12px 12px' }}>
                        {suggestedFeeds.map(gen => <FeedCard key={gen.uri} gen={gen} />)}
                      </div>
                    </>
                  )}

                  {/* Suggested people */}
                  {suggestedActors.length > 0 && (
                    <>
                      <SectionHeader title="People to Follow" />
                      <div style={{ background: 'var(--surface)', borderRadius: 16, margin: '0 12px 8px', overflow: 'hidden' }}>
                        {suggestedActors.map(actor => (
                          <ActorRow key={actor.did} actor={actor} onFollow={handleFollow} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
