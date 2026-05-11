import React from 'react';
import type { Feed } from '../schema';

interface FeedsAllFeedsListProps {
  readonly feeds: Feed[];
}

export default function FeedsAllFeedsList({ feeds }: FeedsAllFeedsListProps) {
  return (
    <div style={{ border: '1px solid var(--sep)', borderRadius: 12, background: 'var(--fill-1)', padding: 12 }}>
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>All feeds</h4>
      <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--label-3)' }}>{feeds.length} configured</p>

      {feeds.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--label-3)' }}>
          No feeds configured yet.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {feeds.map((feed) => (
            <div key={feed.id} style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--label-1)' }}>
                  {feed.title || 'Untitled feed'}
                </p>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'var(--fill-2)',
                    color: 'var(--label-2)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                  }}
                >
                  {feed.type || 'feed'}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--label-3)' }}>
                {(feed.category || 'General')} • {feed.url}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}