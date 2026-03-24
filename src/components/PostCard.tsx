import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { MockPost } from '../data/mockData';
import { formatTime, formatCount } from '../data/mockData';
import VideoPlayer from './VideoPlayer';
import TwemojiText from './TwemojiText';

interface PostCardProps {
  post: MockPost;
  onOpenStory: (entry: any) => void;
  onViewProfile?: (handle: string) => void;
  onToggleRepost?: (post: MockPost) => void;
  onToggleLike?: (post: MockPost) => void;
  onReply?: (post: MockPost) => void;
  index: number;
}

export default function PostCard({ post, onOpenStory, onViewProfile, onToggleRepost, onToggleLike, onReply, index }: PostCardProps) {
  // Handle "open story" click
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking interactive elements
    if ((e.target as HTMLElement).closest('button, a, .video-player-wrapper')) {
      return;
    }
    onOpenStory({ id: post.id, type: 'post' });
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
      onClick={handleCardClick}
      style={{
        background: 'var(--surface-card)',
        borderRadius: 16,
        padding: '16px',
        marginBottom: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        border: '1px solid var(--stroke-dim)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Author Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            onClick={(e) => { e.stopPropagation(); onViewProfile?.(post.author.did); }}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--fill-2)', overflow: 'hidden',
              cursor: 'pointer'
            }}
          >
            {post.author.avatar ? (
              <img src={post.author.avatar} alt={post.author.handle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)', fontWeight: 700 }}>
                {post.author.handle[0]}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)' }}>{post.author.displayName || post.author.handle}</span>
              <span style={{ fontSize: 14, color: 'var(--label-3)' }}>· {formatTime(post.createdAt)}</span>
            </div>
            <span style={{ fontSize: 14, color: 'var(--label-3)' }}>@{post.author.handle}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {post.content && (
        <p style={{
          fontSize: 16, lineHeight: '1.45', color: 'var(--label-1)',
          marginBottom: post.embed || post.media ? 12 : 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          <TwemojiText text={post.content} />
        </p>
      )}

      {/* Embeds */}
      {/* 1. Video Embed */}
      {post.embed?.type === 'video' && (
        <div className="video-player-wrapper" onClick={e => e.stopPropagation()}>
          <VideoPlayer
            url={post.embed.url}
            thumb={post.embed.thumb}
            autoplay={false}
          />
          {post.embed.title && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--label-1)' }}>{post.embed.title}</p>
              <p style={{ fontSize: 13, color: 'var(--label-3)' }}>{post.embed.domain}</p>
            </div>
          )}
        </div>
      )}

      {/* 2. Image Grid */}
      {post.media && post.media.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: post.media.length > 1 ? '1fr 1fr' : '1fr',
          gap: 4, borderRadius: 12, overflow: 'hidden',
          marginTop: 8
        }}>
          {post.media.map((img, i) => (
            <div key={i} style={{
              aspectRatio: img.aspectRatio ? String(img.aspectRatio) : '16/9',
              position: 'relative', background: 'var(--fill-2)'
            }}>
              <img src={img.url} alt={img.alt} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      )}

      {/* 3. External Link */}
      {post.embed?.type === 'external' && (
        <a
          href={post.embed.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'block', textDecoration: 'none',
            border: '1px solid var(--stroke-dim)', borderRadius: 12,
            overflow: 'hidden', marginTop: 8
          }}
        >
          {post.embed.thumb && (
            <div style={{ height: 160, width: '100%', background: 'var(--fill-2)' }}>
              <img src={post.embed.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div style={{ padding: '10px 12px', background: 'var(--fill-1)' }}>
            <div style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: 2 }}>{post.embed.domain}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-1)', lineHeight: 1.3, marginBottom: 4 }}>{post.embed.title}</div>
            {post.embed.description && (
              <div style={{ fontSize: 13, color: 'var(--label-2)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: (post.embed.authorName || post.embed.publisher) ? 6 : 0 }}>
                {post.embed.description}
              </div>
            )}
            {(post.embed.authorName || post.embed.publisher) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, paddingTop: 6, borderTop: '0.5px solid var(--stroke-dim)' }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: 'var(--blue)', background: 'color-mix(in srgb, var(--blue) 12%, transparent)',
                  padding: '2px 7px', borderRadius: 100,
                }}>Featured</span>
                {post.embed.authorName && (
                  <span style={{ fontSize: 12, color: 'var(--label-2)' }}>
                    By <span style={{ fontWeight: 600, color: 'var(--label-1)' }}>{post.embed.authorName}</span>
                  </span>
                )}
                {post.embed.publisher && (
                  <span style={{ fontSize: 12, color: 'var(--label-3)' }}>
                    {post.embed.authorName ? `· ${post.embed.publisher}` : post.embed.publisher}
                  </span>
                )}
              </div>
            )}
          </div>
        </a>
      )}

      {/* 4. Quote Post */}
      {post.embed?.type === 'quote' && (
        <div style={{
          border: '1px solid var(--stroke-dim)', borderRadius: 12,
          padding: 12, marginTop: 8, background: 'var(--fill-1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--fill-3)', overflow: 'hidden' }}>
              {post.embed.post.author.avatar && <img src={post.embed.post.author.avatar} style={{ width: '100%', height: '100%' }} />}
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--label-1)' }}>{post.embed.post.author.displayName}</span>
            <span style={{ fontSize: 13, color: 'var(--label-3)' }}>@{post.embed.post.author.handle}</span>
          </div>
          <p style={{ fontSize: 15, color: 'var(--label-1)', lineHeight: 1.4 }}>
            <TwemojiText text={post.embed.post.content} />
          </p>
        </div>
      )}

      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingRight: 16 }}>
        <ActionButton 
          icon="reply" 
          count={post.replyCount} 
          onClick={() => onReply?.(post)}
        />
        <ActionButton 
          icon="repost" 
          count={post.repostCount} 
          active={!!post.viewer?.repost}
          onClick={() => onToggleRepost?.(post)}
        />
        <ActionButton 
          icon="like" 
          count={post.likeCount} 
          active={!!post.viewer?.like}
          onClick={() => onToggleLike?.(post)}
        />
        <div style={{ width: 24 }} /> {/* Spacer for Share/More */}
      </div>
    </motion.div>
  );
}

// ─── Action Button ────────────────────────────────────────────────────────
function ActionButton({ icon, count, active, onClick }: { icon: 'reply' | 'repost' | 'like', count: number, active?: boolean, onClick?: () => void }) {
  const color = active 
    ? (icon === 'like' ? 'var(--red)' : 'var(--green)')
    : 'var(--label-3)';

  return (
    <button
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'none', border: 'none', padding: '4px 8px',
        cursor: 'pointer', color,
        marginLeft: -8
      }}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      {icon === 'reply' && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
        </svg>
      )}
      {icon === 'repost' && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 1l4 4-4 4"></path>
          <path d="M3 11V9a4 4 0 014-4h14"></path>
          <path d="M7 23l-4-4 4-4"></path>
          <path d="M21 13v2a4 4 0 01-4 4H3"></path>
        </svg>
      )}
      {icon === 'like' && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"></path>
        </svg>
      )}
      <span style={{ fontSize: 13, fontWeight: 500, color: active ? color : 'var(--label-3)' }}>{formatCount(count)}</span>
    </button>
  );
}