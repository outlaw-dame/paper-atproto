import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MOCK_POSTS, MOCK_FEEDS, MOCK_PACKS, formatTime, formatCount } from '../data/mockData';
import type { MockPost } from '../data/mockData';
import type { StoryEntry } from '../App';

interface Props {
  onOpenStory: (e: StoryEntry) => void;
}

const TABS = ['Saved', 'My Feeds', 'My Packs', 'History'] as const;
type Tab = typeof TABS[number];

// ─── Content-type palette ──────────────────────────────────────────────────
const CONTENT_TYPE_CONFIG: Record<string, {
  label: string; icon: React.ReactNode;
  accentBg: string; accentColor: string;
}> = {
  thread: {
    label: 'Thread',
    icon: <ThreadIcon />,
    accentBg: 'rgba(0,122,255,0.12)',
    accentColor: 'var(--blue)',
  },
  topic: {
    label: 'Topic',
    icon: <TopicIcon />,
    accentBg: 'rgba(175,82,222,0.12)',
    accentColor: 'var(--purple)',
  },
  feed: {
    label: 'Feed',
    icon: <FeedIcon />,
    accentBg: 'rgba(90,200,250,0.14)',
    accentColor: 'var(--teal)',
  },
  pack: {
    label: 'Pack',
    icon: <PackIcon />,
    accentBg: 'rgba(52,199,89,0.12)',
    accentColor: 'var(--green)',
  },
  story: {
    label: 'Story',
    icon: <StoryIcon />,
    accentBg: 'rgba(0,122,255,0.12)',
    accentColor: 'var(--blue)',
  },
  related: {
    label: 'Related',
    icon: <RelatedIcon />,
    accentBg: 'rgba(255,149,0,0.12)',
    accentColor: 'var(--orange)',
  },
};

function estimateReadTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

// ─── Hero card (first saved item — large, full-bleed cover) ───────────────
function HeroSavedCard({ post, onOpenStory }: { post: MockPost; onOpenStory: (e: StoryEntry) => void }) {
  const [saved, setSaved] = useState(true);
  const chip = post.chips[0];
  const typeConfig = chip ? CONTENT_TYPE_CONFIG[chip] : null;
  const coverUrl = post.media?.[0]?.url ?? post.embed?.type === 'external' ? (post.embed as any).thumb : null;
  const hasCover = Boolean(coverUrl);
  const readTime = estimateReadTime(post.content);

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
      onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
      style={{
        width: '100%', textAlign: 'left',
        background: 'var(--surface)', borderRadius: 22,
        padding: 0, marginBottom: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: 'none', cursor: 'pointer',
        boxShadow: '0 2px 16px rgba(0,0,0,0.07)',
      }}
    >
      {/* Cover image with gradient overlay */}
      <div style={{ position: 'relative', width: '100%', height: 200, background: 'var(--fill-3)', overflow: 'hidden' }}>
        {hasCover ? (
          <img src={coverUrl!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          // Generative gradient cover when no image
          <div style={{
            width: '100%', height: '100%',
            background: typeConfig
              ? `linear-gradient(135deg, ${typeConfig.accentColor}33 0%, ${typeConfig.accentColor}11 100%)`
              : 'linear-gradient(135deg, rgba(0,122,255,0.18) 0%, rgba(175,82,222,0.12) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ opacity: 0.18, transform: 'scale(3.5)' }}>
              {typeConfig?.icon}
            </div>
          </div>
        )}
        {/* Bottom gradient scrim for text legibility */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.55) 100%)',
        }} />
        {/* Content type badge — top left */}
        {typeConfig && (
          <div style={{
            position: 'absolute', top: 12, left: 12,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '5px 10px', borderRadius: 100,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: '#fff', fontSize: 12, fontWeight: 600,
          }}>
            <span style={{ opacity: 0.9 }}>{typeConfig.icon}</span>
            {typeConfig.label}
          </div>
        )}
        {/* Save button — top right */}
        <button
          onClick={e => { e.stopPropagation(); setSaved(v => !v); }}
          aria-label={saved ? 'Unsave' : 'Save'}
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 34, height: 34, borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: saved ? '#FFD60A' : 'rgba(255,255,255,0.85)',
            border: 'none', cursor: 'pointer',
          }}
        >
          <BookmarkIcon filled={saved} />
        </button>
        {/* Author + time overlay at bottom of image */}
        <div style={{
          position: 'absolute', bottom: 12, left: 14, right: 14,
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.4)' }}>
            {post.author.avatar
              ? <img src={post.author.avatar} alt={post.author.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--blue)', color: '#fff', fontSize: 11, fontWeight: 700 }}>{post.author.displayName[0]}</div>
            }
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.95)', letterSpacing: -0.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.author.displayName}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', flexShrink: 0 }}>{formatTime(post.createdAt)}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '14px 16px 16px' }}>
        <p style={{
          fontSize: 17, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.5,
          color: 'var(--label-1)', marginBottom: 6,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.content}
        </p>
        {/* Metadata row */}
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
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px', borderRadius: 100,
              background: typeConfig.accentBg, color: typeConfig.accentColor,
              fontSize: 11, fontWeight: 600,
            }}>
              {typeConfig.label}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

// ─── Compact saved card (subsequent items — horizontal layout with thumbnail) ─
function CompactSavedCard({ post, index, onOpenStory }: { post: MockPost; index: number; onOpenStory: (e: StoryEntry) => void }) {
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
        width: '100%', textAlign: 'left',
        background: 'var(--surface)', borderRadius: 18,
        padding: 0, marginBottom: 10, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        border: 'none', cursor: 'pointer',
        boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
      }}
    >
      {/* If external embed, show its cover at top */}
      {externalEmbed?.thumb && (
        <div style={{ position: 'relative', width: '100%', height: 140, overflow: 'hidden', background: 'var(--fill-3)' }}>
          <img src={externalEmbed.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.45) 100%)' }} />
          <div style={{
            position: 'absolute', bottom: 10, left: 12,
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 9px', borderRadius: 100,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            color: '#fff', fontSize: 11, fontWeight: 600,
          }}>
            <LinkIcon />
            {externalEmbed.domain}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'row', gap: 0, padding: 0 }}>
        {/* Left: text content */}
        <div style={{ flex: 1, padding: '13px 14px 13px', minWidth: 0 }}>
          {/* Author row */}
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

          {/* Title / content */}
          {externalEmbed ? (
            <>
              <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, letterSpacing: -0.4, color: 'var(--label-1)', marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {externalEmbed.title}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.35, color: 'var(--label-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {externalEmbed.description}
              </p>
            </>
          ) : (
            <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, letterSpacing: -0.3, color: 'var(--label-1)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {post.content}
            </p>
          )}

          {/* Metadata + chip row */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {typeConfig && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 100,
                background: typeConfig.accentBg, color: typeConfig.accentColor,
                fontSize: 11, fontWeight: 600,
              }}>
                {typeConfig.icon}
                {typeConfig.label}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--label-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <ClockIcon size={11} /> {readTime}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={e => { e.stopPropagation(); setSaved(v => !v); }}
              aria-label={saved ? 'Unsave' : 'Save'}
              style={{ color: saved ? 'var(--blue)' : 'var(--label-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
            >
              <BookmarkIcon filled={saved} size={16} />
            </button>
          </div>
        </div>

        {/* Right: thumbnail (only when media present and no external embed cover) */}
        {thumbUrl && !externalEmbed?.thumb && (
          <div style={{ width: 88, flexShrink: 0, position: 'relative', overflow: 'hidden', borderRadius: '0 18px 18px 0' }}>
            <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        )}
      </div>
    </motion.button>
  );
}

// ─── Section header ────────────────────────────────────────────────────────
function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 10, marginTop: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-2)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{title}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, color: 'var(--label-4)', fontWeight: 500 }}>{count}</span>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function LibraryTab({ onOpenStory }: Props) {
  const [tab, setTab] = useState<Tab>('Saved');

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
        <div style={{ display: 'flex', flexDirection: 'row', padding: '0 16px 12px', gap: 8, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 16px', borderRadius: 100, flexShrink: 0,
              fontSize: 14, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#fff' : 'var(--label-2)',
              background: tab === t ? 'var(--blue)' : 'var(--fill-2)',
              border: 'none', cursor: 'pointer',
              transition: 'all 0.18s',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="scroll-y" style={{ flex: 1, padding: '14px 12px 0' }}>
        <AnimatePresence mode="wait">
          {tab === 'Saved' && (
            <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {MOCK_POSTS.length > 0 && MOCK_POSTS[0] != null && (
                <>
                  <SectionHeader title="Reading List" count={MOCK_POSTS.length} />
                  {/* Hero card — first item */}
                  <HeroSavedCard post={MOCK_POSTS[0]} onOpenStory={onOpenStory} />
                  {/* Compact cards — remaining items */}
                  {MOCK_POSTS.slice(1).map((post, i) => (
                    <CompactSavedCard key={post.id} post={post} index={i} onOpenStory={onOpenStory} />
                  ))}
                </>
              )}
            </motion.div>
          )}

          {tab === 'My Feeds' && (
            <motion.div key="feeds" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <SectionHeader title="Subscribed Feeds" count={MOCK_FEEDS.length} />
              {MOCK_FEEDS.map((feed, i) => (
                <motion.div
                  key={feed.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  style={{
                    background: 'var(--surface)', borderRadius: 18, padding: '14px 16px', marginBottom: 10,
                    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                    boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{
                    width: 50, height: 50, borderRadius: 15,
                    background: 'linear-gradient(135deg, rgba(0,122,255,0.15) 0%, rgba(90,200,250,0.15) 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0,
                    border: '1px solid rgba(0,122,255,0.12)',
                  }}>
                    {feed.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 3 }}>{feed.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
                      by <span style={{ color: 'var(--blue)', fontWeight: 500 }}>@{feed.creator.replace('.bsky.social', '')}</span>
                      {' · '}{feed.count.toLocaleString()} posts
                    </p>
                  </div>
                  <button style={{
                    padding: '6px 14px', borderRadius: 100,
                    background: 'rgba(255,59,48,0.1)', color: 'var(--red)',
                    fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
                  }}>
                    Unfollow
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {tab === 'My Packs' && (
            <motion.div key="packs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <SectionHeader title="Starter Packs" count={MOCK_PACKS.length} />
              {MOCK_PACKS.map((pack, i) => (
                <motion.div
                  key={pack.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  style={{
                    background: 'var(--surface)', borderRadius: 18, padding: '14px 16px', marginBottom: 10,
                    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                    boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{
                    width: 50, height: 50, borderRadius: 15,
                    background: 'linear-gradient(135deg, rgba(52,199,89,0.15) 0%, rgba(90,200,250,0.12) 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0,
                    border: '1px solid rgba(52,199,89,0.15)',
                  }}>
                    {pack.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-1)', letterSpacing: -0.3, marginBottom: 3 }}>{pack.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--label-3)' }}>
                      <span style={{ color: 'var(--green)', fontWeight: 600 }}>{pack.memberCount}</span> members
                      {' · '}by <span style={{ color: 'var(--label-2)', fontWeight: 500 }}>@{pack.creator.replace('.bsky.social', '')}</span>
                    </p>
                  </div>
                  <button style={{
                    padding: '6px 14px', borderRadius: 100,
                    background: 'rgba(255,59,48,0.1)', color: 'var(--red)',
                    fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
                  }}>
                    Leave
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {tab === 'History' && (
            <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <SectionHeader title="Recently Viewed" count={6} />
              {MOCK_POSTS.slice(0, 6).map((post, i) => (
                <motion.button
                  key={post.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => onOpenStory({ type: 'post', id: post.id, title: post.author.displayName })}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'var(--surface)', borderRadius: 16,
                    padding: '12px 14px', marginBottom: 8,
                    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                    border: 'none', cursor: 'pointer',
                    boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', background: 'var(--fill-2)', flexShrink: 0 }}>
                    {post.author.avatar
                      ? <img src={post.author.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--indigo)', color: '#fff', fontSize: 13, fontWeight: 700 }}>{post.author.displayName[0]}</div>
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: -0.2 }}>
                      {post.content.slice(0, 72)}…
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--label-3)', marginTop: 2 }}>
                      {post.author.displayName} · {formatTime(post.createdAt)}
                    </p>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div style={{ height: 32 }} />
      </div>
    </div>
  );
}

// ─── Icon components ───────────────────────────────────────────────────────
function ThreadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  );
}
function TopicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function FeedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1" fill="currentColor"/>
    </svg>
  );
}
function PackIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  );
}
function StoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  );
}
function RelatedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}
function BookmarkIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
    </svg>
  );
}
function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    </svg>
  );
}
