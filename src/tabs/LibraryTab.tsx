import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { atpCall, type AtpError } from '../lib/atproto/client';
import { mapFeedViewPost } from '../atproto/mappers';
import type { MockPost } from '../data/mockData';
import { formatTime, formatCount } from '../data/mockData';
import type { StoryEntry } from '../App';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

function getSafeErrorMessage(error: unknown): string {
  const normalized = error as Partial<AtpError>;
  switch (normalized.kind) {
    case 'auth':
      return 'Your session has expired. Please sign in again.';
    case 'forbidden':
      return 'You do not have permission to view this data.';
    case 'rate_limit':
      return 'Request rate limit reached. Please retry in a moment.';
    case 'network':
      return 'Network issue while loading data. Check your connection and try again.';
    case 'server':
      return 'Service temporarily unavailable. Please retry shortly.';
    default:
      return 'Unable to load this section right now.';
  }
}

// ─── Content-type palette ──────────────────────────────────────────────────
const CONTENT_TYPE_CONFIG: Record<string, {
  label: string; icon: React.ReactNode;
  accentBg: string; accentColor: string;
}> = {
  thread: { label: 'Thread', icon: <ThreadIcon />, accentBg: 'rgba(0,122,255,0.12)', accentColor: 'var(--blue)' },
  topic:  { label: 'Topic',  icon: <TopicIcon />,  accentBg: 'rgba(175,82,222,0.12)', accentColor: 'var(--purple)' },
  feed:   { label: 'Feed',   icon: <FeedIcon />,   accentBg: 'rgba(90,200,250,0.14)', accentColor: 'var(--teal)' },
  related:{ label: 'Link',   icon: <LinkIcon2 />,  accentBg: 'rgba(255,149,0,0.12)',  accentColor: 'var(--orange)' },
  story:  { label: 'Story',  icon: <StoryIcon />,  accentBg: 'rgba(0,122,255,0.12)', accentColor: 'var(--blue)' },
};

function estimateReadTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
        </path>
      </svg>
    </div>
  );
}

// ─── Hero card ─────────────────────────────────────────────────────────────
function HeroSavedCard({ post, onOpenStory, touchLike, iconButtonSize }: { post: MockPost; onOpenStory: (e: StoryEntry) => void; touchLike: boolean; iconButtonSize: number }) {
  const [saved, setSaved] = useState(true);
  const chip = post.chips[0];
  const typeConfig = chip ? CONTENT_TYPE_CONFIG[chip] : null;
  const coverUrl = post.media?.[0]?.url ?? (post.embed?.type === 'external' ? (post.embed as any).thumb : null);
  const hasCover = Boolean(coverUrl);
  const readTime = estimateReadTime(post.content);

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
      onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
      style={{
        width: '100%', textAlign: 'left', background: 'var(--surface)', borderRadius: 22,
        padding: 0, marginBottom: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: 'none', cursor: 'pointer', boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: 200, background: 'var(--fill-3)', overflow: 'hidden' }}>
        {hasCover ? (
          <img src={coverUrl!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: typeConfig
              ? `linear-gradient(135deg, ${typeConfig.accentColor}33 0%, ${typeConfig.accentColor}11 100%)`
              : 'linear-gradient(135deg, rgba(0,122,255,0.18) 0%, rgba(175,82,222,0.12) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ opacity: 0.18, transform: 'scale(3.5)' }}>{typeConfig?.icon}</div>
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.55) 100%)' }} />
        {typeConfig && (
          <div style={{
            position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 5,
            minHeight: touchLike ? 32 : undefined,
            padding: touchLike ? '6px 12px' : '5px 10px', borderRadius: 100, background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            color: '#fff', fontSize: 12, fontWeight: 600,
          }}>
            <span style={{ opacity: 0.9 }}>{typeConfig.icon}</span>{typeConfig.label}
          </div>
        )}
        <button
          onClick={e => { e.stopPropagation(); setSaved(v => !v); }}
          aria-label={saved ? 'Unsave' : 'Save'}
          style={{
            position: 'absolute', top: 10, right: 10, width: iconButtonSize, height: iconButtonSize, borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: saved ? '#FFD60A' : 'rgba(255,255,255,0.85)', border: 'none', cursor: 'pointer',
          }}
        >
          <BookmarkIcon filled={saved} />
        </button>
        <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.4)' }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 11, fontWeight: 700 }}>{post.author.displayName[0]}</div>
            }
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.95)', letterSpacing: -0.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.author.displayName}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>{formatTime(post.createdAt)}</span>
        </div>
      </div>
      <div style={{ padding: '14px 16px 16px' }}>
        <p style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.5, color: 'var(--label-1)', marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.content}
        </p>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--label-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ClockIcon /> {readTime}
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--label-4)' }} />
          <span style={{ fontSize: 12, color: 'var(--label-3)' }}>{formatCount(post.likeCount)} likes</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--label-4)' }} />
          <span style={{ fontSize: 12, color: 'var(--label-3)' }}>{formatCount(post.replyCount)} replies</span>
          <div style={{ flex: 1 }} />
          {typeConfig && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 100, background: typeConfig.accentBg, color: typeConfig.accentColor, fontSize: 11, fontWeight: 600 }}>
              {typeConfig.label}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

// ─── Compact card ──────────────────────────────────────────────────────────
function CompactSavedCard({ post, index, onOpenStory, touchLike }: { post: MockPost; index: number; onOpenStory: (e: StoryEntry) => void; touchLike: boolean }) {
  const [saved, setSaved] = useState(true);
  const chip = post.chips[0];
  const typeConfig = chip ? CONTENT_TYPE_CONFIG[chip] : null;
  const thumbUrl = post.media?.[0]?.url ?? (post.embed?.type === 'external' ? (post.embed as any).thumb : null);
  const readTime = estimateReadTime(post.content);
  const isExternal = post.embed?.type === 'external';
  const externalEmbed = isExternal ? (post.embed as { type: 'external'; url: string; title: string; description: string; thumb?: string; domain: string }) : null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
      style={{
        width: '100%', textAlign: 'left', background: 'var(--surface)', borderRadius: 18,
        padding: 0, marginBottom: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: 'none', cursor: 'pointer', boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
      }}
    >
      {externalEmbed?.thumb && (
        <div style={{ position: 'relative', width: '100%', height: 140, overflow: 'hidden', background: 'var(--fill-3)' }}>
          <img src={externalEmbed.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.45) 100%)' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 12, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 100, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
            <LinkIcon2 />{externalEmbed.domain}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 0, padding: 0 }}>
        <div style={{ flex: 1, padding: '13px 14px 13px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
              {post.author.avatar
                ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 9, fontWeight: 700 }}>{post.author.displayName[0]}</div>
              }
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', letterSpacing: -0.1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {post.author.displayName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--label-4)', flexShrink: 0 }}>{formatTime(post.createdAt)}</span>
          </div>
          {externalEmbed ? (
            <>
              {'authorName' in externalEmbed && typeof externalEmbed.authorName === 'string' && externalEmbed.authorName.length > 0 && (
                <p style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: 'var(--teal)' }}>Featured author:</span> {externalEmbed.authorName}
                  {'publisher' in externalEmbed && typeof externalEmbed.publisher === 'string' && externalEmbed.publisher.length > 0
                    ? <span style={{ marginLeft: 8, color: 'var(--label-4)' }}>· {externalEmbed.publisher}</span>
                    : null}
                </p>
              )}
              <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.4, color: 'var(--label-1)', marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{externalEmbed.title}</p>
              <p style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--label-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{externalEmbed.description}</p>
            </>
          ) : (
            <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, letterSpacing: -0.3, color: 'var(--label-1)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.content}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {typeConfig && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: touchLike ? 28 : undefined, padding: touchLike ? '4px 9px' : '3px 8px', borderRadius: 100, background: typeConfig.accentBg, color: typeConfig.accentColor, fontSize: 11, fontWeight: 600 }}>
                {typeConfig.icon}{typeConfig.label}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--label-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <ClockIcon size={11} /> {readTime}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={e => { e.stopPropagation(); setSaved(v => !v); }} aria-label={saved ? 'Unsave' : 'Save'} style={{ color: saved ? 'var(--blue)' : 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', minWidth: touchLike ? 32 : 24, minHeight: touchLike ? 32 : 24, borderRadius: '50%' }}>
              <BookmarkIcon filled={saved} size={16} />
            </button>
          </div>
        </div>
        {thumbUrl && !externalEmbed?.thumb && (
          <div style={{ width: 88, flexShrink: 0, position: 'relative', overflow: 'hidden', borderRadius: '0 18px 18px 0' }}>
            <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        )}
      </div>
    </motion.button>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 10, marginTop: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-2)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</span>
      {count !== undefined && <span style={{ fontSize: 12, color: 'var(--label-4)', fontWeight: 500 }}>{count}</span>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function LibraryTab({ onOpenStory }: Props) {
  const platform = usePlatform();
  const iconBtnTokens = getIconBtnTokens(platform);
  const touchLike = platform.isMobile || platform.prefersCoarsePointer || platform.hasAnyCoarsePointer;
  const { agent, session } = useSessionStore();
  const [savedPosts, setSavedPosts] = useState<MockPost[]>([]);
  const [loadingManual, setLoadingManual] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchSaved = useCallback(async () => {
    if (!session) return;
    setLoadingManual(true);
    setErrorMessage(null);
    try {
      const res = await atpCall(s => agent.getActorLikes({ actor: session.did, limit: 30 }));
      const posts = res.data.feed
        .filter(item => (item.post?.record as any)?.text !== undefined)
        .map(mapFeedViewPost);
      setSavedPosts(posts);
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error));
    }
    finally { setLoadingManual(false); }
  }, [agent, session]);

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Nav */}
      <div style={{
        flexShrink: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        background: 'var(--chrome-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid var(--sep)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--label-1)', letterSpacing: -0.8 }}>Library</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px 10px' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-3)', letterSpacing: -0.2 }}>
            Saved posts and bookmarks
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="scroll-y" style={{ flex: 1, padding: '14px 12px 0' }}>
        {errorMessage && (
          <div style={{ marginBottom: 10, borderRadius: 12, border: '1px solid var(--sep)', background: 'color-mix(in srgb, var(--surface) 92%, var(--orange) 8%)', padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{errorMessage}</p>
          </div>
        )}
        <AnimatePresence mode="wait">
          {loadingManual ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Spinner />
            </motion.div>
          ) : (
            <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {savedPosts.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', gap: 12 }}>
                  <p style={{ fontSize: 14, color: 'var(--label-3)' }}>Posts you like will appear here.</p>
                </div>
              ) : (
                <>
                  <SectionHeader title="Liked Posts" count={savedPosts.length} />
                  {savedPosts[0] != null && <HeroSavedCard post={savedPosts[0]} onOpenStory={onOpenStory} touchLike={touchLike} iconButtonSize={iconBtnTokens.size} />}
                  {savedPosts.slice(1).map((post, i) => (
                    <CompactSavedCard key={post.id} post={post} index={i} onOpenStory={onOpenStory} touchLike={touchLike} />
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ height: 32 }} />
      </div>
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────
function ThreadIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
}
function TopicIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function FeedIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1" fill="currentColor"/></svg>;
}
function StoryIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>;
}
function LinkIcon2() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
}
function BookmarkIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>;
}
function ClockIcon({ size = 12 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}
