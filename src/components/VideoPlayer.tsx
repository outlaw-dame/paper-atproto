import React, { useState } from 'react';

interface VideoPlayerProps {
  url: string;
  thumb?: string;
  aspectRatio?: number;
  autoplay?: boolean;
}

/**
 * A simple video player wrapper using native HTML5 <video>.
 * Shows an optional thumbnail overlay and a play button to reduce auto-play overhead.
 */
export default function VideoPlayer({ url, thumb, aspectRatio = 16 / 9, autoplay = false }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoplay);

  return (
    <div style={{
      position: 'relative',
      paddingTop: `${(1 / aspectRatio) * 100}%`,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#000',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {!isPlaying && thumb && (
        <img
          src={thumb}
          alt="video thumbnail"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            cursor: 'pointer',
          }}
          onClick={() => setIsPlaying(true)}
        />
      )}
      {!isPlaying && (
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </button>
      )}
      {isPlaying && (
        <video
          src={url}
          controls
          autoPlay
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
