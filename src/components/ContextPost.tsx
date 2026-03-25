import React from 'react';
import type { MockPost } from '../data/mockData.js';
import TwemojiText from './TwemojiText.js';

export const ContextPost = ({
  post,
  type,
  onClick,
}: {
  post: MockPost;
  type: 'reply' | 'thread';
  onClick?: () => void;
}) => (
  <div
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-label={onClick ? (type === 'thread' ? 'Open original post' : 'Open replied-to post') : undefined}
    title={onClick ? (type === 'thread' ? 'Tap to open original post' : 'Tap to open replied-to post') : undefined}
    onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    style={{
      padding: '8px 12px 0 54px',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      background: 'var(--surface-card)',
      borderRadius: 12,
      border: '1px solid var(--stroke-dim)',
      marginBottom: 8,
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <div style={{
      position: 'absolute',
      top: 0,
      bottom: -16,
      left: 30,
      width: '2px',
      backgroundColor: 'var(--fill-3)',
    }} />
    
    {/* Label row: "Thread root" label on left only for thread type; open hint always on right */}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ fontSize: 'var(--type-meta-sm-size)', color: 'var(--label-3)', fontWeight: 500 }}>
        {type === 'thread' ? 'Original post' : ''}
      </span>
      {onClick && (
        <span style={{ fontSize: 11, color: 'var(--label-4, var(--label-3))', display: 'flex', alignItems: 'center', gap: 2, opacity: 0.65 }}>
          {type === 'thread' ? 'Open original' : 'Open post'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="7" y1="17" x2="17" y2="7"/>
            <polyline points="7 7 17 7 17 17"/>
          </svg>
        </span>
      )}
    </div>
    {/* Author name */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--type-body-sm-size)', color: 'var(--label-1)' }}>
      <span style={{ fontWeight: 600 }}>{post.author.displayName || post.author.handle}</span>
      <span style={{ color: 'var(--label-3)', fontSize: '0.85em' }}>@{post.author.handle}</span>
    </div>

    {/* Content preview */}
    <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--label-2)', lineHeight: 1.3, maxHeight: '3.9em', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      <TwemojiText text={post.content} />
    </p>
  </div>
);

export default ContextPost;