import React, { useState, useRef, useEffect } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerContext.js';

interface VideoPlayerProps {
  url: string;
  thumb?: string;
  aspectRatio?: number;
  autoplay?: boolean;
  /** Post ID — used to associate this player with a mini-player session */
  postId?: string;
}

/**
 * Inline video player with mini-player support.
 * When the user scrolls away while a video is playing, it automatically
 * transitions to the floating MiniPlayer at the bottom of the screen.
 */
export default function VideoPlayer({ url, thumb, aspectRatio = 16 / 9, autoplay = false, postId }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { entry: miniEntry, activate } = useMiniPlayer();

  // Is the floating mini-player currently showing this video?
  const isInMiniPlayer = miniEntry?.url === url && miniEntry?.postId === (postId ?? url);

  // When playing, watch intersection — if video scrolls off screen, send it to mini-player
  useEffect(() => {
    if (!isPlaying || isInMiniPlayer || !containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.intersectionRatio >= 0.2) return;
        // Save current playback time before we unmount the video element
        const currentTime = videoRef.current?.currentTime ?? 0;
        activate({
          url,
          aspectRatio,
          startTime: currentTime,
          postId: postId ?? url,
          ...(thumb ? { thumb } : {}),
        });
        setIsPlaying(false);
      },
      { threshold: [0, 0.2] },
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isPlaying, isInMiniPlayer, url, thumb, aspectRatio, postId, activate]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        paddingTop: `${(1 / aspectRatio) * 100}%`,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#000',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      {/* Thumbnail */}
      {thumb && (
        <img
          src={thumb}
          alt="video thumbnail"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            cursor: isInMiniPlayer ? 'default' : 'pointer',
          }}
          onClick={isInMiniPlayer ? undefined : () => setIsPlaying(true)}
        />
      )}

      {/* "Playing in mini-player" overlay */}
      {isInMiniPlayer && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.52)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {/* Picture-in-picture icon */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <rect x="12" y="11" width="8" height="6" rx="1" fill="rgba(255,255,255,0.85)" stroke="none"/>
          </svg>
          <span style={{
            color: 'rgba(255,255,255,0.75)',
            fontSize: 11,
            letterSpacing: 0.1,
          }}>
            Playing in mini-player
          </span>
        </div>
      )}

      {/* Play button (not playing, not in mini-player) */}
      {!isPlaying && !isInMiniPlayer && (
        <button
          onClick={() => setIsPlaying(true)}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.6)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Play video"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M8 5v14l11-7z" fill="currentColor"/>
          </svg>
        </button>
      )}

      {/* Actual video — only mounted while playing inline */}
      {isPlaying && !isInMiniPlayer && (
        <video
          ref={videoRef}
          src={url}
          controls
          autoPlay
          playsInline
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
    </div>
  );
}
