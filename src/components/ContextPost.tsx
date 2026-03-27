import React from 'react';
import type { MockPost } from '../data/mockData.js';
import { formatTime } from '../data/mockData.js';
import TwemojiText from './TwemojiText.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
import { useUiStore } from '../store/uiStore.js';

export const ContextPost = ({
  post,
  type,
  onClick,
}: {
  post: MockPost;
  type: 'reply' | 'thread';
  onClick?: () => void;
}) => {
  const navigateToProfile = useProfileNavigation();
  const openExploreSearch = useUiStore((state) => state.openExploreSearch);
  const authorActor = post.author.did || post.author.handle;
  const authorInitial = (post.author.displayName || post.author.handle || '?').trim().charAt(0).toUpperCase() || '?';
  const contextLabel = type === 'thread' ? 'Thread start' : 'Earlier reply';
  const quoteEmbed = post.embed?.type === 'quote' ? post.embed : null;
  const externalEmbed = post.embed?.type === 'external' ? post.embed : null;
  const videoEmbed = post.embed?.type === 'video' ? post.embed : null;
  const secondaryLabel = quoteEmbed
    ? 'Quote post'
    : post.article
      ? 'Article'
      : externalEmbed
        ? externalEmbed.domain
        : videoEmbed
          ? `Video · ${videoEmbed.domain}`
          : null;

  const handleHashtagClick = (tag: string) => {
    const normalized = tag.replace(/^#/, '').trim();
    if (!normalized) return;
    openExploreSearch(normalized);
  };

  return (
  <div
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-label={
      type === 'thread'
        ? `Original post by ${post.author.displayName || post.author.handle}`
        : `Replied-to post by ${post.author.displayName || post.author.handle}`
    }
    onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    style={{
      display: 'flex',
      paddingLeft: 16,
      paddingRight: 16,
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    {/* Left column: avatar + thread connector line */}
    <div style={{
      width: 40,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flexShrink: 0,
      marginRight: 10,
    }}>
      {/* Avatar */}
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'var(--fill-2)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {post.author.avatar ? (
          <img
            src={post.author.avatar}
            alt={post.author.handle}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--label-2)',
            fontWeight: 700,
            fontSize: 'var(--type-label-md-size)',
          }}>
            {authorInitial}
          </div>
        )}
      </div>
      {/* Thread connector line — runs from below avatar down to PostCard */}
      <div style={{
        width: 2,
        flex: 1,
        minHeight: 12,
        backgroundColor: 'var(--sep-opaque)',
        borderRadius: 1,
        marginTop: 4,
      }} />
    </div>

    {/* Right column: author + content preview */}
    <div style={{ flex: 1, minWidth: 0, paddingBottom: 8, paddingTop: 2 }}>
      <div style={{
        border: '0.5px solid var(--stroke-dim)',
        borderRadius: 16,
        background: 'var(--surface-card)',
        padding: '12px 14px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 22,
            borderRadius: 999,
            padding: '0 10px',
            fontSize: 'var(--type-meta-sm-size)',
            lineHeight: 'var(--type-meta-sm-line)',
            letterSpacing: '0.04em',
            fontWeight: 800,
            textTransform: 'uppercase',
            color: 'var(--blue)',
            background: 'rgba(0, 122, 255, 0.12)',
            border: '1px solid rgba(0, 122, 255, 0.18)',
          }}>
            {contextLabel}
          </span>
          {secondaryLabel && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 22,
              borderRadius: 999,
              padding: '0 10px',
              fontSize: 'var(--type-meta-sm-size)',
              lineHeight: 'var(--type-meta-sm-line)',
              fontWeight: 700,
              color: 'var(--label-2)',
              background: 'var(--fill-1)',
              border: '1px solid var(--stroke-dim)',
            }}>
              {secondaryLabel}
            </span>
          )}
          <span style={{
            fontSize: 'var(--type-meta-sm-size)',
            lineHeight: 'var(--type-meta-sm-line)',
            color: 'var(--label-3)',
            fontWeight: 600,
          }}>
            {formatTime(post.createdAt)}
          </span>
          {onClick && (
            <span style={{
              marginLeft: 'auto',
              fontSize: 'var(--type-meta-sm-size)',
              color: 'var(--label-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
              opacity: 0.8,
            }}>
              Open
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7"/>
                <polyline points="7 7 17 7 17 17"/>
              </svg>
            </span>
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
        }}>
          <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(authorActor); }} style={{
            fontSize: 'var(--type-label-md-size)',
            lineHeight: 'var(--type-label-md-line)',
            letterSpacing: 'var(--type-label-md-track)',
            fontWeight: 700,
            color: 'var(--label-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer'
          }}>
            {post.author.displayName || post.author.handle}
          </button>
          <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(authorActor); }} style={{
            fontSize: 'var(--type-meta-md-size)',
            lineHeight: 'var(--type-meta-md-line)',
            letterSpacing: 'var(--type-meta-md-track)',
            color: 'var(--label-3)',
            flexShrink: 0,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer'
          }}>
            @{post.author.handle}
          </button>
        </div>

        {post.content.trim().length > 0 && (
          <p
            className="clamp-3"
            style={{
              margin: 0,
              fontSize: 'var(--type-body-sm-size)',
              lineHeight: 'var(--type-body-sm-line)',
              letterSpacing: 'var(--type-body-sm-track)',
              color: 'var(--label-1)',
              wordBreak: 'break-word',
            }}
          >
            <TwemojiText text={post.content} onMention={(handle) => { void navigateToProfile(handle); }} onHashtag={handleHashtagClick} />
          </p>
        )}

        {quoteEmbed && (
          <div style={{
            marginTop: post.content.trim().length > 0 ? 10 : 0,
            border: '1px solid var(--stroke-dim)',
            borderRadius: 12,
            background: 'var(--fill-1)',
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 'var(--type-meta-sm-line)',
                color: 'var(--label-3)',
                fontWeight: 700,
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7h10a4 4 0 010 8H9"/>
                  <path d="M13 7l-4 4 4 4"/>
                </svg>
                Quoted post
              </span>
              <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(quoteEmbed.post.author.did || quoteEmbed.post.author.handle); }} style={{
                fontSize: 'var(--type-label-md-size)',
                lineHeight: 'var(--type-label-md-line)',
                fontWeight: 700,
                color: 'var(--label-1)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}>
                {quoteEmbed.post.author.displayName || quoteEmbed.post.author.handle}
              </button>
              <button className="interactive-link-button" onClick={(e) => { e.stopPropagation(); void navigateToProfile(quoteEmbed.post.author.did || quoteEmbed.post.author.handle); }} style={{
                fontSize: 'var(--type-meta-md-size)',
                lineHeight: 'var(--type-meta-md-line)',
                color: 'var(--label-3)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}>
                @{quoteEmbed.post.author.handle}
              </button>
            </div>
            {quoteEmbed.post.content.trim().length > 0 && (
              <p className="clamp-2" style={{
                margin: 0,
                fontSize: 'var(--type-body-sm-size)',
                lineHeight: 'var(--type-body-sm-line)',
                color: 'var(--label-2)',
                wordBreak: 'break-word',
              }}>
                <TwemojiText text={quoteEmbed.post.content} onMention={(handle) => { void navigateToProfile(handle); }} onHashtag={handleHashtagClick} />
              </p>
            )}
            {quoteEmbed.externalLink && (
              <div style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '0.5px solid var(--stroke-dim)',
                fontSize: 'var(--type-meta-sm-size)',
                lineHeight: 'var(--type-meta-sm-line)',
                color: 'var(--label-3)',
                fontWeight: 600,
              }}>
                {quoteEmbed.externalLink.title || quoteEmbed.externalLink.domain}
              </div>
            )}
          </div>
        )}

        {externalEmbed && (
          <div style={{
            marginTop: post.content.trim().length > 0 ? 10 : 0,
            border: '1px solid var(--stroke-dim)',
            borderRadius: 12,
            background: 'var(--fill-1)',
            padding: '10px 12px',
          }}>
            <div style={{
              fontSize: 'var(--type-meta-sm-size)',
              lineHeight: 'var(--type-meta-sm-line)',
              color: 'var(--label-3)',
              fontWeight: 700,
              marginBottom: 4,
            }}>
              Shared link
            </div>
            <div style={{
              fontSize: 'var(--type-label-md-size)',
              lineHeight: 'var(--type-label-md-line)',
              color: 'var(--label-1)',
              fontWeight: 700,
              marginBottom: 2,
            }}>
              {externalEmbed.title}
            </div>
            <div style={{
              fontSize: 'var(--type-meta-md-size)',
              lineHeight: 'var(--type-meta-md-line)',
              color: 'var(--label-3)',
            }}>
              {externalEmbed.domain}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};

export default ContextPost;
