import React, { useMemo } from 'react';
import ReactPlayer from 'react-player';
import { openExternalUrl, sanitizeExternalUrl } from '../lib/safety/externalUrl';
import { buildYouTubeThumbnailUrl, parseYouTubeUrl } from '../lib/youtube';

interface YouTubeEmbedCardProps {
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  thumb?: string | undefined;
  domain?: string | undefined;
  compact?: boolean;
  openButtonLabel?: string | undefined;
}

export default function YouTubeEmbedCard({
  url,
  title,
  description,
  thumb,
  domain,
  compact = false,
  openButtonLabel,
}: YouTubeEmbedCardProps) {
  const reference = useMemo(() => parseYouTubeUrl(url), [url]);
  const safeUrl = sanitizeExternalUrl(reference?.normalizedUrl ?? url);

  if (!reference || !safeUrl) {
    return null;
  }

  const previewImage = thumb
    || (reference.videoId ? buildYouTubeThumbnailUrl(reference.videoId) : undefined)
    || true;
  const metaDomain = domain || reference.domain;
  const providerLabel = reference.kind === 'playlist'
    ? 'YouTube playlist'
    : reference.kind === 'short'
      ? 'YouTube Short'
      : 'YouTube';
  const resolvedTitle = title?.trim()
    || (reference.kind === 'playlist' ? 'YouTube playlist' : 'Watch on YouTube');

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        border: '1px solid var(--stroke-dim, rgba(120,120,120,0.22))',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--fill-1, rgba(255,255,255,0.04))',
      }}
    >
      <div
        style={{
          position: 'relative',
          paddingTop: `${(1 / (16 / 9)) * 100}%`,
          background: '#000',
        }}
      >
        <div style={{ position: 'absolute', inset: 0 }}>
          <ReactPlayer
            src={safeUrl}
            controls
            playsInline
            width="100%"
            height="100%"
            light={previewImage}
            previewAriaLabel={resolvedTitle}
            config={{
              youtube: {
                rel: 0,
                ...(reference.startSeconds !== undefined ? { start: reference.startSeconds } : {}),
              },
            }}
          />
        </div>
      </div>
      <div style={{ padding: compact ? '10px 12px' : '12px 14px' }}>
        <div
          style={{
            fontSize: compact ? 11 : 12,
            lineHeight: compact ? '14px' : '16px',
            color: 'var(--label-3, rgba(120,120,120,0.9))',
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          {providerLabel}
          {metaDomain ? ` · ${metaDomain}` : ''}
        </div>
        <div
          style={{
            fontSize: compact ? 13 : 15,
            lineHeight: compact ? '18px' : '20px',
            color: 'var(--label-1, inherit)',
            fontWeight: 700,
            marginBottom: description ? 6 : 0,
          }}
        >
          {resolvedTitle}
        </div>
        {description && (
          <div
            style={{
              fontSize: compact ? 12 : 13,
              lineHeight: compact ? '17px' : '18px',
              color: 'var(--label-2, rgba(120,120,120,0.92))',
              display: '-webkit-box',
              WebkitLineClamp: compact ? 2 : 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginBottom: 10,
            }}
          >
            {description}
          </div>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openExternalUrl(safeUrl);
          }}
          style={{
            border: 'none',
            borderRadius: 999,
            background: 'rgba(255,0,0,0.12)',
            color: '#cc1f1f',
            padding: compact ? '5px 10px' : '6px 12px',
            fontSize: compact ? 11 : 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {openButtonLabel || (reference.kind === 'playlist' ? 'Open playlist' : 'Open on YouTube')}
        </button>
      </div>
    </div>
  );
}
