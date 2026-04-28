import React, { useEffect, useMemo, useState, startTransition } from 'react';
import { openExternalUrl, sanitizeExternalUrl } from '../lib/safety/externalUrl';
import { buildYouTubeEmbedUrl, buildYouTubeThumbnailUrl, parseYouTubeUrl } from '../lib/youtube';

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
  const [showInlinePlayer, setShowInlinePlayer] = useState(false);
  const reference = useMemo(() => parseYouTubeUrl(url), [url]);
  const safeUrl = sanitizeExternalUrl(reference?.normalizedUrl ?? url);
  const inlineEmbedUrl = useMemo(
    () => (reference ? buildYouTubeEmbedUrl(reference, { autoplay: true }) : null),
    [reference],
  );
  const safeThumb = thumb
    ? sanitizeExternalUrl(thumb, {
        stripTracking: true,
        stripHash: true,
        rejectLocalHosts: true,
      })
    : null;

  if (!reference || !safeUrl) {
    return null;
  }

  useEffect(() => {
    setShowInlinePlayer(false);
  }, [safeUrl]);

  const previewImage = safeThumb
    || (reference.videoId ? buildYouTubeThumbnailUrl(reference.videoId) : undefined)
    || null;
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
          {showInlinePlayer && inlineEmbedUrl ? (
            <iframe
              src={inlineEmbedUrl}
              title={resolvedTitle}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                display: 'block',
              }}
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!inlineEmbedUrl) {
                  void openExternalUrl(safeUrl);
                  return;
                }
                startTransition(() => {
                  setShowInlinePlayer(true);
                });
              }}
              aria-label={reference.kind === 'playlist' ? 'Play YouTube playlist inline' : 'Play YouTube video inline'}
              style={{
                appearance: 'none',
                width: '100%',
                height: '100%',
                border: 'none',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                position: 'relative',
                display: 'block',
                background: previewImage
                  ? `center / cover no-repeat url("${previewImage}")`
                  : 'linear-gradient(180deg, rgba(18,18,18,0.84), rgba(0,0,0,0.96))',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.42))',
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.68)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  boxShadow: '0 12px 24px rgba(0,0,0,0.24)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <span
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: '11px solid transparent',
                    borderBottom: '11px solid transparent',
                    borderLeft: '18px solid #fff',
                    marginLeft: 4,
                  }}
                />
              </span>
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 999,
                  background: 'rgba(0,0,0,0.62)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                }}
              >
                {reference.kind === 'playlist' ? 'Play playlist' : 'Play inline'}
              </span>
            </button>
          )}
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
