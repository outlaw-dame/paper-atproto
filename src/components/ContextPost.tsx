import React from 'react';
import type { MockPost } from '../data/mockData';

export const ContextPost = ({ post, type }: { post: MockPost, type: 'reply' | 'thread' }) => (
  <div style={{
    padding: '8px 12px 0 54px',
    position: 'relative',
    opacity: 0.8,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }}>
    <div style={{
      position: 'absolute',
      top: 0,
      bottom: -16, // Extend line to connect to the card below
      left: 30,
      width: '2px',
      backgroundColor: 'var(--fill-3)',
    }} />
    
    {/* Header line with Author name */}
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--type-body-sm-size)', color: 'var(--label-2)' }}>
      <span style={{ fontWeight: 600 }}>{post.author.displayName || post.author.handle}</span>
      <span style={{ color: 'var(--label-3)' }}>·</span>
      <span style={{ color: 'var(--label-3)' }}>
        {type === 'thread' ? 'Thread start' : 'Replying to above'}
      </span>
    </div>

    {/* Content preview */}
    <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--label-2)', lineHeight: 1.3, maxHeight: '3.9em', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {post.content}
    </p>
  </div>
);

export default ContextPost;