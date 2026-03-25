import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { MockPost } from '../data/mockData';
import { formatTime, formatCount } from '../data/mockData';
import VideoPlayer from './VideoPlayer';
import TwemojiText from './TwemojiText';
import { useTranslationStore } from '../store/translationStore.js';
import { translationClient } from '../lib/i18n/client.js';

interface PostCardProps {
  post: MockPost;
  onOpenStory: (entry: any) => void;
  onViewProfile?: (handle: string) => void;
  onToggleRepost?: (post: MockPost) => void;
  onToggleLike?: (post: MockPost) => void;
  onQuote?: (post: MockPost) => void;
  onReply?: (post: MockPost) => void;
  onBookmark?: (post: MockPost) => void;
  onMore?: (post: MockPost) => void;
  index: number;
  /** Handle of the post being replied to — shown as "↳ Replying to @handle" */
  replyingTo?: string | undefined;
}

export default function PostCard({ post, onOpenStory, onViewProfile, onToggleRepost, onToggleLike, onQuote, onReply, onBookmark, onMore, index, replyingTo }: PostCardProps) {
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(false);
  const [expandedAltIndex, setExpandedAltIndex] = useState<number | null>(null);
  const { policy, byId, upsertTranslation, clearTranslation } = useTranslationStore();
  const translation = byId[post.id];
  const autoAttemptedRef = useRef(false);

  const storyRootId = post.threadRoot?.id ?? post.id;
  const storyTitle = post.threadRoot?.content?.slice(0, 80) ?? post.content.slice(0, 80);

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewProfile?.(post.author.did);
  };

  // Handle "open story" click
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking interactive elements
    if ((e.target as HTMLElement).closest('button, a, .video-player-wrapper')) {
      return;
    }
    onOpenStory({ id: storyRootId, type: 'post', title: storyTitle });
  };

  const handleRepostToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRepostMenu(prev => !prev);
  };

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (translation) {
      setShowOriginal((prev) => !prev);
      return;
    }

    if (!post.content.trim()) return;
    setTranslating(true);
    setTranslationError(false);
    try {
      const result = await translationClient.translateInline({
        id: post.id,
        sourceText: post.content,
        targetLang: policy.userLanguage,
        mode: policy.localOnlyMode ? 'local_private' : 'server_default',
      });
      upsertTranslation(result);
      setShowOriginal(false);
    } catch (err) {
      console.warn('[PostCard] translation failed', err);
      setTranslationError(true);
    } finally {
      setTranslating(false);
    }
  };

  const handleClearTranslation = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTranslation(post.id);
    setShowOriginal(false);
  };

  const displayContent = translation && !showOriginal
    ? translation.translatedText
    : post.content;

  const canAutoInlineTranslate = useMemo(() => {
    const hasEmbed = !!post.embed;
    const hasMedia = !!post.media?.length;
    const textLength = post.content.trim().length;
    if (textLength === 0 || textLength > 280) return false;
    if (hasEmbed || hasMedia) return false;
    return true;
  }, [post.content, post.embed, post.media]);

  useEffect(() => {
    if (translation || translating) return;
    if (!policy.autoTranslateFeed) return;
    if (!canAutoInlineTranslate) return;
    if (autoAttemptedRef.current) return;

    autoAttemptedRef.current = true;
    setTranslating(true);
    setTranslationError(false);

    translationClient.translateInline({
      id: post.id,
      sourceText: post.content,
      targetLang: policy.userLanguage,
      mode: policy.localOnlyMode ? 'local_private' : 'server_default',
    }).then((result) => {
      upsertTranslation(result);
      setShowOriginal(false);
    }).catch((err) => {
      console.warn('[PostCard] auto translation failed', err);
      setTranslationError(true);
    }).finally(() => {
      setTranslating(false);
    });
  }, [canAutoInlineTranslate, policy.autoTranslateFeed, policy.localOnlyMode, policy.userLanguage, post.content, post.id, translation, translating, upsertTranslation]);

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
            onClick={handleProfileClick}
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
          <div
            onClick={handleProfileClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onViewProfile?.(post.author.did);
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)' }}>{post.author.displayName || post.author.handle}</span>
              <span style={{ fontSize: 14, color: 'var(--label-3)' }}>· {formatTime(post.createdAt)}</span>
            </div>
            <span style={{ fontSize: 14, color: 'var(--label-3)' }}>@{post.author.handle}</span>
          </div>
        </div>
      </div>

      {/* Reply-to attribution */}
      {replyingTo && (
        <p style={{ fontSize: 13, color: 'var(--label-3)', margin: '0 0 6px', fontWeight: 500 }}>
          ↳ Replying to <span style={{ color: 'var(--blue)' }}>@{replyingTo}</span>
        </p>
      )}

      {/* Content */}
      {post.content && (
        <p style={{
          fontSize: 16, lineHeight: '1.45', color: 'var(--label-1)',
          marginBottom: post.embed || post.media ? 12 : 4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          <TwemojiText text={displayContent} />
        </p>
      )}

      {post.content.trim().length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: -2 }}>
          <button
            onClick={handleTranslate}
            disabled={translating}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--blue)',
              fontSize: 13,
              fontWeight: 600,
              padding: 0,
              cursor: translating ? 'default' : 'pointer',
              opacity: translating ? 0.65 : 1,
            }}
          >
            {translation
              ? (showOriginal ? 'Show translation' : 'Show original')
              : (translating
                ? 'Translating...'
                : 'Translate')}
          </button>
          {translationError && !translation && (
            <span style={{ fontSize: 12, color: 'var(--red)' }}>Failed to translate</span>
          )}
        </div>
      )}

      {translation && !showOriginal && (
        <div style={{
          marginBottom: 10,
          border: '1px solid var(--stroke-dim)',
          borderRadius: 10,
          background: 'color-mix(in srgb, var(--surface-card) 80%, var(--blue) 6%)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '7px 9px',
            borderBottom: '1px solid var(--stroke-dim)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 8l6 6" />
                <path d="M4 14l6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="M22 22l-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
              <span style={{ fontSize: 11, color: 'var(--label-2)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {policy.autoTranslateFeed && canAutoInlineTranslate
                  ? `Auto-translated from ${translation.sourceLang}`
                  : `Translated from ${translation.sourceLang}`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button
                onClick={handleTranslate}
                style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }}
              >
                Show original
              </button>
              <button
                onClick={handleClearTranslation}
                style={{ border: 'none', background: 'transparent', color: 'var(--label-3)', fontSize: 11, fontWeight: 600, padding: 0, cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Embeds */}
      {/* 1. Video Embed */}
      {post.embed?.type === 'video' && (
        <div className="video-player-wrapper" onClick={e => e.stopPropagation()}>
          <VideoPlayer
            url={post.embed.url}
            {...(post.embed.thumb ? { thumb: post.embed.thumb } : {})}
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
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: post.media.length > 1 ? '1fr 1fr' : '1fr',
            gap: 4, borderRadius: 12, overflow: 'hidden',
            marginTop: 8
          }}>
            {post.media.map((img, i) => {
              const alt = (img.alt ?? '').trim();
              const hasAlt = alt.length > 0;
              return (
                <div key={i} style={{
                  aspectRatio: img.aspectRatio ? String(img.aspectRatio) : '16/9',
                  position: 'relative', background: 'var(--fill-2)'
                }}>
                  <img src={img.url} alt={img.alt ?? ''} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />

                  {hasAlt && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedAltIndex(prev => (prev === i ? null : i));
                      }}
                      style={{
                        position: 'absolute',
                        right: 8,
                        bottom: 8,
                        border: 'none',
                        background: 'rgba(0,0,0,0.56)',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 800,
                        borderRadius: 999,
                        padding: '4px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      ALT
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {expandedAltIndex !== null && post.media[expandedAltIndex] && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 8,
                border: '1px solid var(--stroke-dim)',
                borderRadius: 10,
                background: 'var(--fill-1)',
                padding: '9px 10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-3)' }}>
                  Media description {expandedAltIndex + 1}/{post.media.length}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedAltIndex(null);
                  }}
                  style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, padding: 0, cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: 'var(--label-2)', whiteSpace: 'pre-wrap' }}>
                {(post.media[expandedAltIndex].alt ?? '').trim()}
              </p>
            </div>
          )}
        </>
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
        <ActionButton 
          icon="bookmark" 
          count={post.bookmarkCount || 0} 
          active={!!post.viewer?.bookmark}
          onClick={() => onBookmark?.(post)}
        />
        <ActionButton 
          icon="more" 
          count={0}
          onClick={() => onMore?.(post)}
        />
      </div>
    </motion.div>
  );
}

// ─── Action Button ────────────────────────────────────────────────────────
function ActionButton({ icon, count, active, onClick }: { icon: 'reply' | 'repost' | 'like' | 'bookmark' | 'more', count: number, active?: boolean, onClick?: () => void }) {
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
      {icon === 'bookmark' && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? 0 : 2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      )}
      {icon === 'more' && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      )}
      {icon !== 'more' && <span style={{ fontSize: 13, fontWeight: 500, color: active ? color : 'var(--label-3)' }}>{formatCount(count)}</span>}
    </button>
  );
}