import React, { useState } from 'react';
import type { PodcastClipResult } from '../lib/exploreSearchResults';
import AudioEmbed from './AudioEmbed';

interface PodcastClipCardProps {
  clip: PodcastClipResult;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function truncateText(text: string, maxLen: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen).trimEnd()}…` : trimmed;
}

export default function PodcastClipCard({ clip }: PodcastClipCardProps) {
  const [showFullEpisode, setShowFullEpisode] = useState(false);

  const hasTimestamp = clip.startTime > 0 || clip.endTime !== undefined;
  const timestampLabel = hasTimestamp
    ? clip.endTime !== undefined
      ? `${formatTimestamp(clip.startTime)} – ${formatTimestamp(clip.endTime)}`
      : `at ${formatTimestamp(clip.startTime)}`
    : null;

  const audioDescription = clip.feedTitle
    ? `${clip.feedTitle}`
    : undefined;

  return (
    <div
      style={{
        background: 'var(--fill-1)',
        borderRadius: 16,
        border: '0.5px solid var(--sep)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header row: badge + timestamp + feed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            background: 'rgba(91,124,255,0.18)',
            color: 'var(--blue)',
            borderRadius: 999,
            padding: '3px 8px',
            flexShrink: 0,
          }}
        >
          Clip
        </span>
        {timestampLabel && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--label-2)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timestampLabel}
          </span>
        )}
        {clip.feedTitle && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--label-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 160,
            }}
          >
            · {clip.feedTitle}
          </span>
        )}
      </div>

      {/* Episode title */}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--label-1)',
          letterSpacing: -0.2,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {clip.episodeTitle}
      </p>

      {/* Matching transcript text */}
      {clip.text && (
        <blockquote
          style={{
            margin: 0,
            paddingLeft: 10,
            borderLeft: '3px solid var(--blue)',
            fontSize: 13,
            color: 'var(--label-2)',
            lineHeight: 1.5,
            fontStyle: 'italic',
          }}
        >
          {clip.speaker && (
            <span style={{ fontWeight: 700, fontStyle: 'normal', color: 'var(--label-1)', marginRight: 4 }}>
              {clip.speaker}:
            </span>
          )}
          {truncateText(clip.text, 220)}
        </blockquote>
      )}

      {/* Inline audio player — clip-bounded or full episode */}
      <AudioEmbed
        url={clip.enclosureUrl}
        title={clip.episodeTitle}
        {...(audioDescription ? { description: audioDescription } : {})}
        {...(!showFullEpisode ? { clipStart: clip.startTime } : {})}
        {...(!showFullEpisode && clip.endTime !== undefined ? { clipEnd: clip.endTime } : {})}
      />

      {/* Full episode toggle — only show when we have a meaningful clip start */}
      {hasTimestamp && (
        <button
          type="button"
          onClick={() => setShowFullEpisode((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--blue)',
            padding: 0,
          }}
        >
          {showFullEpisode ? 'Back to clip' : 'Play full episode'}
        </button>
      )}
    </div>
  );
}
