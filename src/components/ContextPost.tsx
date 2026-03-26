import React from 'react';
import type { MockPost } from '../data/mockData.js';
import TwemojiText from './TwemojiText.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';

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
  const authorActor = post.author.did || post.author.handle;
  const authorInitial = (post.author.displayName || post.author.handle || '?').trim().charAt(0).toUpperCase() || '?';

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
      {/* Author row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 3,
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
        {onClick && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 'var(--type-meta-sm-size)',
            color: 'var(--label-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
            opacity: 0.7,
          }}>
            Open
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7"/>
              <polyline points="7 7 17 7 17 17"/>
            </svg>
          </span>
        )}
      </div>

      {/* Content preview — 2-line clamp */}
      <p
        className="clamp-2"
        style={{
          margin: 0,
          fontSize: 'var(--type-body-sm-size)',
          lineHeight: 'var(--type-body-sm-line)',
          letterSpacing: 'var(--type-body-sm-track)',
          color: 'var(--label-2)',
          wordBreak: 'break-word',
        }}
      >
        <TwemojiText text={post.content} onMention={(handle) => { void navigateToProfile(handle); }} />
      </p>
    </div>
  </div>
  );
};

export default ContextPost;
