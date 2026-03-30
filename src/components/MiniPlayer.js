import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useRef, useState, useEffect } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerContext.js';
import { getMediaPlaybackPrefs, saveMediaPlaybackPrefs } from '../lib/mediaPlayback.js';
/**
 * Floating mini-player — stays fixed at bottom-right above the tab bar.
 * Appears when the user scrolls away from an in-progress video in their feed.
 * Inspired by Arc browser's mini-player and YouTube's mobile floating player.
 */
export default function MiniPlayer() {
    const { entry, dismiss } = useMiniPlayer();
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const lastPersistAtRef = useRef(0);
    const mediaKey = entry ? `video:${entry.postId ?? entry.url}` : null;
    // Seek to the saved position and begin playback when a new entry arrives
    useEffect(() => {
        if (!entry || !videoRef.current || !mediaKey)
            return;
        const v = videoRef.current;
        const prefs = getMediaPlaybackPrefs(mediaKey);
        const resumeTime = entry.startTime > 0
            ? entry.startTime
            : (prefs?.positionSeconds ?? 0);
        v.currentTime = resumeTime;
        if (prefs?.playbackRate && prefs.playbackRate > 0) {
            v.playbackRate = prefs.playbackRate;
            setPlaybackRate(prefs.playbackRate);
        }
        v.play().catch(() => setIsPlaying(false));
        setIsPlaying(true);
    }, [entry?.url, entry?.startTime, mediaKey]);
    useEffect(() => {
        return () => {
            const v = videoRef.current;
            if (!v || !mediaKey)
                return;
            saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: v.currentTime,
                playbackRate: v.playbackRate,
            });
        };
    }, [mediaKey]);
    if (!entry)
        return null;
    const MINI_W = 200;
    const MINI_H = Math.round(MINI_W / entry.aspectRatio);
    const togglePlay = (e) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v)
            return;
        if (isPlaying) {
            v.pause();
            setIsPlaying(false);
        }
        else {
            v.play().catch(() => { });
            setIsPlaying(true);
        }
    };
    const seekBy = (delta) => {
        const v = videoRef.current;
        if (!v)
            return;
        const upperBound = duration || v.duration || 0;
        const nextTime = Math.max(0, Math.min(upperBound, v.currentTime + delta));
        v.currentTime = nextTime;
        setCurrentTime(nextTime);
    };
    const handleSeek = (event) => {
        event.stopPropagation();
        const v = videoRef.current;
        if (!v)
            return;
        const nextTime = Number(event.target.value);
        v.currentTime = nextTime;
        setCurrentTime(nextTime);
    };
    const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0)
            return '0:00';
        const safeSeconds = Math.floor(seconds);
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const handleRateChange = (event) => {
        event.stopPropagation();
        const nextRate = Number(event.target.value);
        const v = videoRef.current;
        if (!v || !Number.isFinite(nextRate) || nextRate <= 0)
            return;
        v.playbackRate = nextRate;
        setPlaybackRate(nextRate);
        if (mediaKey) {
            saveMediaPlaybackPrefs(mediaKey, { playbackRate: nextRate });
        }
    };
    return (_jsxs(_Fragment, { children: [_jsx("style", { children: `
        @keyframes miniPlayerIn {
          from { opacity: 0; transform: translateY(20px) scale(0.92); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      ` }), _jsxs("div", { style: {
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
                }, children: [_jsx("video", { ref: videoRef, src: entry.url, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }, onClick: togglePlay, onLoadedMetadata: (event) => {
                            const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
                            setDuration(nextDuration);
                            setCurrentTime(event.currentTarget.currentTime || 0);
                            setPlaybackRate(event.currentTarget.playbackRate || 1);
                        }, onTimeUpdate: (event) => {
                            const nextTime = event.currentTarget.currentTime;
                            setCurrentTime(nextTime);
                            const now = Date.now();
                            if (mediaKey && now - lastPersistAtRef.current >= 2000) {
                                saveMediaPlaybackPrefs(mediaKey, {
                                    positionSeconds: nextTime,
                                    playbackRate: event.currentTarget.playbackRate,
                                });
                                lastPersistAtRef.current = now;
                            }
                        }, onEnded: (event) => {
                            setIsPlaying(false);
                            if (mediaKey) {
                                saveMediaPlaybackPrefs(mediaKey, {
                                    positionSeconds: 0,
                                    playbackRate: event.currentTarget.playbackRate,
                                });
                            }
                        }, onPlay: () => setIsPlaying(true), onPause: (event) => {
                            setIsPlaying(false);
                            if (mediaKey) {
                                saveMediaPlaybackPrefs(mediaKey, {
                                    positionSeconds: event.currentTarget.currentTime,
                                    playbackRate: event.currentTarget.playbackRate,
                                });
                            }
                        } }), _jsxs("div", { style: {
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            padding: '6px 6px 7px',
                            background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.66) 100%)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            zIndex: 1,
                        }, children: [_jsx("input", { type: "range", min: 0, max: duration > 0 ? duration : 0, step: 0.1, value: Math.min(currentTime, duration || currentTime), onChange: handleSeek, onClick: (e) => e.stopPropagation(), "aria-label": "Seek mini-player video", style: { width: '100%' } }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    seekBy(-10);
                                                }, type: "button", "aria-label": "Rewind 10 seconds", style: { border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', cursor: 'pointer' }, children: "-10" }), _jsx("button", { onClick: togglePlay, type: "button", "aria-label": isPlaying ? 'Pause mini-player video' : 'Play mini-player video', style: { border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', cursor: 'pointer' }, children: isPlaying ? 'Pause' : 'Play' }), _jsx("button", { onClick: (e) => {
                                                    e.stopPropagation();
                                                    seekBy(10);
                                                }, type: "button", "aria-label": "Forward 10 seconds", style: { border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', cursor: 'pointer' }, children: "+10" }), _jsxs("select", { value: playbackRate, onChange: handleRateChange, onClick: (e) => e.stopPropagation(), "aria-label": "Mini-player playback speed", style: { border: 'none', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 4px', cursor: 'pointer' }, children: [_jsx("option", { value: 0.75, children: "0.75x" }), _jsx("option", { value: 1, children: "1x" }), _jsx("option", { value: 1.25, children: "1.25x" }), _jsx("option", { value: 1.5, children: "1.5x" }), _jsx("option", { value: 2, children: "2x" })] })] }), _jsx("span", { style: { color: 'rgba(255,255,255,0.9)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }, children: formatTime(currentTime) })] })] }), !isPlaying && (_jsx("div", { style: {
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.35)',
                            pointerEvents: 'none',
                        }, children: _jsx("div", { style: {
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                backgroundColor: 'rgba(0,0,0,0.65)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backdropFilter: 'blur(4px)',
                            }, children: _jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "#fff", children: _jsx("path", { d: "M8 5v14l11-7z" }) }) }) })), _jsx("button", { onClick: (e) => { e.stopPropagation(); dismiss(); }, style: {
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
                            zIndex: 2,
                        }, "aria-label": "Close mini player", children: _jsxs("svg", { width: "9", height: "9", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", children: [_jsx("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), _jsx("line", { x1: "6", y1: "6", x2: "18", y2: "18" })] }) })] })] }));
}
//# sourceMappingURL=MiniPlayer.js.map