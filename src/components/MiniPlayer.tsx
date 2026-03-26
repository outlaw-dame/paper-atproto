import React, { useRef, useState, useEffect } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerContext.js';

/**
 * Floating mini-player — stays fixed at bottom-right above the tab bar.
 * Appears when the user scrolls away from an in-progress video in their feed.
 * Inspired by Arc browser's mini-player and YouTube's mobile floating player.
 */
export default function MiniPlayer() {
  const { entry, dismiss } = useMiniPlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Seek to the saved position and begin playback when a new entry arrives
  useEffect(() => {
    if (!entry || !videoRef.current) return;
    const v = videoRef.current;
    v.currentTime = entry.startTime;
    v.play().catch(() => setIsPlaying(false));
    setIsPlaying(true);
  }, [entry?.url, entry?.startTime]);

  if (!entry) return null;

  const MINI_W = 200;
  const MINI_H = Math.round(MINI_W / entry.aspectRatio);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  return (
    <>
      <style>{`
        @keyframes miniPlayerIn {
          from { opacity: 0; transform: translateY(20px) scale(0.92); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          right: 12,
          bottom: 'calc(49px + var(--safe-bottom, 0px) + 12px)',
          width: MINI_W,
          height: MINI_H,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: '#000',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.25)',
          zIndex: 200,
          animation: 'miniPlayerIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        {/* Video */}
        <video
          ref={videoRef}
          src={entry.url}
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />

        {/* Tap-to-toggle-play overlay (full area) */}
        <button
          onClick={togglePlay}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        />

        {/* Paused state: center play icon */}
        {!isPlaying && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.35)',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          </div>
        )}

        {/* Close button — top-right */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.65)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            WebkitTapHighlightColor: 'transparent',
            zIndex: 1,
          }}
          aria-label="Close mini player"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </>
  );
}
