import React, { useState, useRef, useEffect, useCallback } from 'react';

interface AudioEmbedProps {
  url: string;
  title?: string;
  description?: string; // "Artist\nAlbum" format
  thumbnail?: string;   // cover art URL
  className?: string;
  clipStart?: number;   // seconds — auto-seek on load and restrict playback start
  clipEnd?: number;     // seconds — pause when reached
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export default function AudioEmbed({ url, title, description, thumbnail, className, clipStart, clipEnd }: AudioEmbedProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const dataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(0) as Uint8Array<ArrayBuffer>);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  // Parse artist/album from description
  const lines = description ? description.split('\n') : [];
  const artist = lines[0] ?? '';
  const album = lines[1] ?? '';

  // ── Web Audio API setup ──────────────────────────────────────────────────
  const setupAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || analyserRef.current) return;
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      sourceRef.current = source;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    } catch {
      // Web Audio not available — visualizer will be skipped
    }
  }, []);

  // ── Canvas waveform ──────────────────────────────────────────────────────
  const drawBars = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);

    if (analyser && playing) {
      analyser.getByteFrequencyData(dataRef.current);
      const bars = 40;
      const barW = (W / bars) * 0.7;
      const gap = (W / bars) * 0.3;
      const step = Math.floor(dataRef.current.length / bars);
      for (let i = 0; i < bars; i++) {
        const value = dataRef.current[i * step] ?? 0;
        const barH = Math.max(3, (value / 255) * H);
        const x = i * (barW + gap);
        const y = (H - barH) / 2;
        const alpha = 0.4 + (value / 255) * 0.6;
        ctx2d.fillStyle = `rgba(0, 122, 255, ${alpha})`;
        ctx2d.beginPath();
        ctx2d.roundRect?.(x, y, barW, barH, 2) ?? ctx2d.rect(x, y, barW, barH);
        ctx2d.fill();
      }
    } else {
      // Static idle bars
      const bars = 40;
      const barW = (W / bars) * 0.7;
      const gap = (W / bars) * 0.3;
      for (let i = 0; i < bars; i++) {
        // Gentle sine wave idle state
        const wave = Math.sin((i / bars) * Math.PI * 2) * 0.35 + 0.15;
        const barH = Math.max(3, wave * H);
        const x = i * (barW + gap);
        const y = (H - barH) / 2;
        ctx2d.fillStyle = 'rgba(128,128,128,0.25)';
        ctx2d.beginPath();
        ctx2d.roundRect?.(x, y, barW, barH, 2) ?? ctx2d.rect(x, y, barW, barH);
        ctx2d.fill();
      }
    }

    if (playing) {
      animFrameRef.current = requestAnimationFrame(drawBars);
    }
  }, [playing]);

  // Start/stop animation loop when playing state changes
  useEffect(() => {
    if (playing) {
      animFrameRef.current = requestAnimationFrame(drawBars);
    } else {
      cancelAnimationFrame(animFrameRef.current);
      drawBars(); // draw idle state once
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playing, drawBars]);

  // Draw idle bars on mount
  useEffect(() => {
    drawBars();
  }, [drawBars]);

  // ── Audio event handlers ────────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    setupAnalyser();
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    setPlaying(true);
  }, [setupAnalyser]);

  const handlePause = useCallback(() => setPlaying(false), []);
  const handleEnded = useCallback(() => setPlaying(false), []);
  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    // Enforce clip end boundary
    if (clipEnd !== undefined && Number.isFinite(clipEnd) && audio.currentTime >= clipEnd) {
      audio.pause();
      audio.currentTime = clipEnd;
    }
  }, [clipEnd]);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    setDuration(audio.duration);
    // Auto-seek to clip start when metadata is available
    if (clipStart !== undefined && Number.isFinite(clipStart) && clipStart > 0) {
      audio.currentTime = clipStart;
      setCurrentTime(clipStart);
    }
  }, [clipStart]);

  // ── Controls ─────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const handleSpeedChange = useCallback((s: typeof SPEEDS[number]) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  }, []);

  // Keyboard: Space to play/pause when focused
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
  }, [togglePlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      void audioCtxRef.current?.close();
    };
  }, []);

  // Clip-aware bounds for the scrubber
  const scrubMin = (clipStart !== undefined && Number.isFinite(clipStart)) ? clipStart : 0;
  const scrubMax = (clipEnd !== undefined && Number.isFinite(clipEnd)) ? clipEnd : (duration || 1);
  const scrubRange = Math.max(1, scrubMax - scrubMin);
  const progress = scrubRange > 0 ? Math.max(0, Math.min(1, (currentTime - scrubMin) / scrubRange)) : 0;

  return (
    <div
      className={className}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={title ? `Audio: ${title}` : 'Audio player'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--fill-1)',
        border: '0.5px solid var(--sep)',
        padding: '12px 14px',
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      />

      {/* Top row: cover art + meta */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {/* Cover art */}
        <div style={{
          width: 52, height: 52, borderRadius: 10,
          background: 'var(--fill-3)',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {thumbnail && !thumbError ? (
            <img
              src={thumbnail}
              alt=""
              onError={() => setThumbError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            // Music note fallback icon
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--label-3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
          )}
        </div>

        {/* Title + artist/album */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 14, fontWeight: 700,
            color: 'var(--label-1)', letterSpacing: -0.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title || 'Audio'}
          </p>
          {artist && (
            <p style={{
              margin: '2px 0 0', fontSize: 12, color: 'var(--label-3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {artist}{album ? ` · ${album}` : ''}
            </p>
          )}
        </div>

        {/* Speed selector */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowSpeedMenu(v => !v)}
            aria-label="Playback speed"
            style={{
              background: 'var(--fill-2)', border: 'none', cursor: 'pointer',
              padding: '4px 8px', borderRadius: 999,
              fontSize: 11, fontWeight: 800, color: 'var(--label-2)',
              letterSpacing: 0.2,
            }}
          >
            {speed === 1 ? '1×' : `${speed}×`}
          </button>
          {showSpeedMenu && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 6px)', right: 0,
              background: 'var(--surface)', borderRadius: 12,
              border: '0.5px solid var(--sep)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
              overflow: 'hidden', zIndex: 10,
            }}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeedChange(s)}
                  style={{
                    display: 'block', width: '100%',
                    padding: '9px 18px',
                    background: s === speed ? 'rgba(0,122,255,0.08)' : 'none',
                    border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: s === speed ? 700 : 400,
                    color: s === speed ? 'var(--blue)' : 'var(--label-1)',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s === 1 ? '1× Normal' : `${s}×`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        width={320}
        height={40}
        aria-hidden
        style={{ width: '100%', height: 40, borderRadius: 6 }}
      />

      {/* Progress scrubber */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          type="range"
          min={scrubMin}
          max={scrubMax}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          aria-label="Seek"
          style={{
            width: '100%', height: 4,
            appearance: 'none', WebkitAppearance: 'none',
            background: `linear-gradient(to right, var(--blue) ${progress * 100}%, var(--fill-3) ${progress * 100}%)`,
            borderRadius: 999, cursor: 'pointer', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--label-4)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(Math.max(0, currentTime - scrubMin))}
          </span>
          <span style={{ fontSize: 11, color: 'var(--label-4)', fontVariantNumeric: 'tabular-nums' }}>
            {scrubRange > 1 ? formatTime(scrubRange) : '--:--'}
          </span>
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {/* Mute button */}
        <button
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--label-3)',
          }}
        >
          {muted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 010 7.07"/>
              <path d="M19.07 4.93a10 10 0 010 14.14"/>
            </svg>
          )}
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--blue)', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
            boxShadow: playing ? '0 0 0 4px rgba(0,122,255,0.2)' : 'none',
            transition: 'box-shadow 0.18s ease',
          }}
        >
          {playing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          )}
        </button>

        {/* Skip forward 15s */}
        <button
          onClick={() => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
          }}
          aria-label="Skip forward 15 seconds"
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--label-3)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4"/>
            <path d="M4 20v-7a4 4 0 014-4h12"/>
            <text x="7.5" y="21" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">15</text>
          </svg>
        </button>
      </div>
    </div>
  );
}
