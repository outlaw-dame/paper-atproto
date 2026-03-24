import React, { useState } from 'react';
import ReactPlayer from 'react-player/lazy';

interface VideoPlayerProps {
  url: string;
  thumb?: string;
  aspectRatio?: number;
  autoplay?: boolean;
}

/**
 * A high-quality, lazy-loaded video player wrapper.
 * Uses 'light' mode to show a thumbnail preview until interaction,
 * preserving feed performance.
 */
export default function VideoPlayer({ url, thumb, aspectRatio = 16 / 9, autoplay = false }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoplay);

  return (
    <div
      className="video-player-wrapper"
      style={{
        position: 'relative',
        paddingTop: `${(1 / aspectRatio) * 100}%`,
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: '#000',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      <ReactPlayer
        url={url}
        light={thumb || true} // Use provided thumb or let react-player fetch it
        playing={isPlaying}
        controls
        width="100%"
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
        onPlay={() => setIsPlaying(true)}
        playIcon={
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ marginLeft: '4px' }}>
            <path d="M8 5v14l11-7z" />
          </svg>
          </div>
        }
      />
    </div>
  );
}