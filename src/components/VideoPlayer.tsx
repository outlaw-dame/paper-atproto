import React, { useState, useRef, useEffect } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerContext';
import { getMediaPlaybackPrefs, saveMediaPlaybackPrefs } from '../lib/mediaPlayback';
import { resolveApiUrl } from '../lib/apiBase';
import {
  describeSourceKind,
  describeSupportLevel,
  detectVideoSourceKind,
  getLikelySourceSupport,
  getLikelyUnsupportedReason,
  getVideoPlaybackCapabilities,
} from '../lib/mediaSupport';

interface VideoPlayerProps {
  url: string;
  thumb?: string;
  aspectRatio?: number;
  autoplay?: boolean;
  captions?: Array<{
    lang: string;
    url: string;
    label?: string;
  }>;
  /** Post ID — used to associate this player with a mini-player session */
  postId?: string;
}

/**
 * Inline video player with mini-player support.
 * When the user scrolls away while a video is playing, it automatically
 * transitions to the floating MiniPlayer at the bottom of the screen.
 */
export default function VideoPlayer({ url, thumb, aspectRatio = 16 / 9, autoplay = false, captions = [], postId }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [useProxyForNativeHls, setUseProxyForNativeHls] = useState(false);
  const [hlsMode, setHlsMode] = useState<'pending' | 'native' | 'hlsjs' | 'unsupported'>(() => (
    detectVideoSourceKind(url) === 'hls' ? 'pending' : 'native'
  ));
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsInstanceRef = useRef<{ destroy: () => void } | null>(null);
  const lastPersistAtRef = useRef(0);
  const { entry: miniEntry, activate } = useMiniPlayer();
  const mediaKey = `video:${postId ?? url}`;
  const [capabilities] = useState(() => getVideoPlaybackCapabilities());
  const sourceKind = detectVideoSourceKind(url);
  const proxiedUrl = resolveApiUrl(`/api/media/proxy?url=${encodeURIComponent(url)}`);
  const likelySourceSupport = getLikelySourceSupport(capabilities, sourceKind);
  const likelyUnsupportedReason = getLikelyUnsupportedReason(capabilities, sourceKind);
  const sourceSupportWarning = playbackError ?? likelyUnsupportedReason;
  const shouldAttemptInlinePlayback = sourceKind === 'hls'
    ? hlsMode !== 'unsupported'
    : likelySourceSupport !== false;
  const capabilityRows = [
    capabilities.hls,
    capabilities.mp4,
    capabilities.mp4H264Aac,
    capabilities.mp4HevcAac,
    capabilities.mp4Av1Aac,
    capabilities.webm,
    capabilities.webmVp9Opus,
    capabilities.webmVp8Vorbis,
  ];
  const shouldShowCapabilityPanel = showCapabilities;

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

  useEffect(() => {
    if (!autoplay || isInMiniPlayer) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => setIsPlaying(false));
  }, [autoplay, isInMiniPlayer]);

  useEffect(() => {
    setUseProxyForNativeHls(false);
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isInMiniPlayer) return;

    hlsInstanceRef.current?.destroy();
    hlsInstanceRef.current = null;

    if (sourceKind !== 'hls') {
      setHlsMode('native');
      return;
    }

    const nativeHls = typeof video.canPlayType === 'function'
      && (video.canPlayType('application/vnd.apple.mpegurl') !== '' || video.canPlayType('application/x-mpegURL') !== '');

    if (nativeHls) {
      setHlsMode('native');
      setPlaybackError(null);
      return;
    }

    let cancelled = false;
    setHlsMode('pending');

    void import('hls.js')
      .then((module) => {
        if (cancelled) return;
        const Hls = module.default;
        if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
          setHlsMode('unsupported');
          setPlaybackError('This browser cannot play this HLS stream inline.');
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hlsInstanceRef.current = hls;
        setHlsMode('hlsjs');
        setPlaybackError(null);

        hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          setPlaybackError('Unable to play this HLS stream inline.');
          setHlsMode('unsupported');
          hls.destroy();
          hlsInstanceRef.current = null;
        });

        hls.attachMedia(video);
        hls.loadSource(proxiedUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setHlsMode('unsupported');
        setPlaybackError('Unable to initialize HLS playback in this browser.');
      });

    return () => {
      cancelled = true;
      hlsInstanceRef.current?.destroy();
      hlsInstanceRef.current = null;
    };
  }, [isInMiniPlayer, proxiedUrl, sourceKind, url]);

  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v) return;
      saveMediaPlaybackPrefs(mediaKey, {
        positionSeconds: v.currentTime,
        playbackRate: v.playbackRate,
      });
    };
  }, [mediaKey]);

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const safeSeconds = Math.floor(seconds);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const nextTime = Math.max(0, Math.min((duration || v.duration || 0), v.currentTime + delta));
    v.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => setIsPlaying(false));
      return;
    }
    v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const nextTime = Number(event.target.value);
    v.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const enterFullscreen = () => {
    const node = containerRef.current;
    if (!node || !document.fullscreenEnabled) return;
    node.requestFullscreen().catch(() => {});
  };

  const handleRateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextRate = Number(event.target.value);
    const v = videoRef.current;
    if (!v || !Number.isFinite(nextRate) || nextRate <= 0) return;
    v.playbackRate = nextRate;
    setPlaybackRate(nextRate);
    saveMediaPlaybackPrefs(mediaKey, { playbackRate: nextRate });
  };

  const handlePlaybackError = () => {
    if (sourceKind === 'hls' && hlsMode === 'native' && !useProxyForNativeHls) {
      setUseProxyForNativeHls(true);
      setPlaybackError(null);
      return;
    }
    const generic = 'This browser could not play the current video source.';
    setPlaybackError(likelyUnsupportedReason ?? generic);
    setIsPlaying(false);
  };

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
      {shouldShowCapabilityPanel && !isInMiniPlayer && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            right: 10,
            zIndex: 11,
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.14)',
            padding: '10px 12px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.02em' }}>Video formats</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.74)' }}>
                Source: {describeSourceKind(sourceKind)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCapabilities(false);
                setPlaybackError(null);
              }}
              style={{
                border: 'none',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                borderRadius: 999,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              Hide
            </button>
          </div>
          {sourceSupportWarning && (
            <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.4, color: '#FFD7A8' }}>
              {sourceSupportWarning}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', fontSize: 11 }}>
            {capabilityRows.map((row) => (
              <React.Fragment key={row.key}>
                <span style={{ color: 'rgba(255,255,255,0.82)' }}>{row.label}</span>
                <span style={{ color: row.supported ? '#97F0C2' : 'rgba(255,255,255,0.62)', fontWeight: 700 }}>
                  {describeSupportLevel(row.level)}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

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

      {/* Graceful fallback for unsupported/failed inline playback */}
      {!isInMiniPlayer && (!shouldAttemptInlinePlayback || playbackError) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 12,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.58) 0%, rgba(0,0,0,0.76) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '16px 18px',
          }}
        >
          <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
            Inline playback is unavailable on this source
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.3)',
                background: 'rgba(255,255,255,0.16)',
                color: '#fff',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Open video
            </a>
            <button
              type="button"
              onClick={() => setShowCapabilities((prev) => !prev)}
              style={{
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.9)',
                borderRadius: 999,
                padding: '6px 10px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Details
            </button>
          </div>
          {sourceSupportWarning && (
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.75)', fontSize: 11, textAlign: 'center' }}>
              {sourceSupportWarning}
            </p>
          )}
        </div>
      )}

      {/* Play button (not playing, not in mini-player) */}
      {!isInMiniPlayer && shouldAttemptInlinePlayback && !playbackError && (
        <>
          <video
            ref={videoRef}
            src={sourceKind === 'hls' ? (hlsMode === 'native' ? (useProxyForNativeHls ? proxiedUrl : url) : undefined) : url}
            autoPlay={autoplay}
            playsInline
            preload="metadata"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            onClick={togglePlay}
            onCanPlay={() => setPlaybackError(null)}
            onLoadedMetadata={(event) => {
              const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              const prefs = getMediaPlaybackPrefs(mediaKey);
              setDuration(nextDuration);
              if (prefs?.playbackRate && prefs.playbackRate > 0) {
                event.currentTarget.playbackRate = prefs.playbackRate;
              }
              if (prefs?.positionSeconds && prefs.positionSeconds > 0) {
                event.currentTarget.currentTime = Math.min(prefs.positionSeconds, nextDuration || prefs.positionSeconds);
              }
              setCurrentTime(event.currentTarget.currentTime || 0);
              setIsMuted(event.currentTarget.muted);
              setPlaybackRate(event.currentTarget.playbackRate || 1);
              setPlaybackError(null);
            }}
            onTimeUpdate={(event) => {
              const nextTime = event.currentTarget.currentTime;
              setCurrentTime(nextTime);
              const now = Date.now();
              if (now - lastPersistAtRef.current >= 2000) {
                saveMediaPlaybackPrefs(mediaKey, {
                  positionSeconds: nextTime,
                  playbackRate: event.currentTarget.playbackRate,
                });
                lastPersistAtRef.current = now;
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={(event) => {
              setIsPlaying(false);
              saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: event.currentTarget.currentTime,
                playbackRate: event.currentTarget.playbackRate,
              });
            }}
            onError={handlePlaybackError}
            onEnded={(event) => {
              setIsPlaying(false);
              saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: 0,
                playbackRate: event.currentTarget.playbackRate,
              });
            }}
          >
            {captions.map((caption, index) => (
              <track
                key={`${caption.lang}-${caption.url}-${index}`}
                kind="captions"
                src={caption.url}
                srcLang={caption.lang}
                label={caption.label || caption.lang.toUpperCase()}
                default={index === 0}
              />
            ))}
          </video>

          {!isPlaying && (
            <button
              onClick={togglePlay}
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

          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '8px 10px 10px',
              background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.1}
              value={Math.min(currentTime, duration || currentTime)}
              onChange={handleSeek}
              aria-label="Seek video"
              style={{ width: '100%' }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={togglePlay} type="button" aria-label={isPlaying ? 'Pause video' : 'Play video'} style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button onClick={() => seekBy(-10)} type="button" aria-label="Rewind 10 seconds" style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                  -10s
                </button>
                <button onClick={() => seekBy(10)} type="button" aria-label="Forward 10 seconds" style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                  +10s
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.92)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <button onClick={toggleMute} type="button" aria-label={isMuted ? 'Unmute video' : 'Mute video'} style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.92)', fontSize: 11 }}>
                  Speed
                  <select
                    value={playbackRate}
                    onChange={handleRateChange}
                    aria-label="Video playback speed"
                    style={{ borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', padding: '3px 6px', cursor: 'pointer' }}
                  >
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                  </select>
                </label>
                <button onClick={enterFullscreen} type="button" aria-label="Open fullscreen" style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                  Full
                </button>
                <button
                  onClick={() => setShowCapabilities((prev) => !prev)}
                  type="button"
                  aria-label="Show playback formats"
                  aria-pressed={showCapabilities}
                  style={{ border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}
                >
                  Formats
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
