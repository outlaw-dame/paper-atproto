import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useRef, useEffect } from 'react';
import { useMiniPlayer } from '../context/MiniPlayerContext.js';
import { getMediaPlaybackPrefs, saveMediaPlaybackPrefs } from '../lib/mediaPlayback.js';
import { describeSourceKind, describeSupportLevel, detectVideoSourceKind, getLikelySourceSupport, getLikelyUnsupportedReason, getVideoPlaybackCapabilities, } from '../lib/mediaSupport.js';
/**
 * Inline video player with mini-player support.
 * When the user scrolls away while a video is playing, it automatically
 * transitions to the floating MiniPlayer at the bottom of the screen.
 */
export default function VideoPlayer({ url, thumb, aspectRatio = 16 / 9, autoplay = false, postId }) {
    const [isPlaying, setIsPlaying] = useState(autoplay);
    const [isMuted, setIsMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showCapabilities, setShowCapabilities] = useState(false);
    const [playbackError, setPlaybackError] = useState(null);
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const lastPersistAtRef = useRef(0);
    const { entry: miniEntry, activate } = useMiniPlayer();
    const mediaKey = `video:${postId ?? url}`;
    const [capabilities] = useState(() => getVideoPlaybackCapabilities());
    const sourceKind = detectVideoSourceKind(url);
    const likelySourceSupport = getLikelySourceSupport(capabilities, sourceKind);
    const likelyUnsupportedReason = getLikelyUnsupportedReason(capabilities, sourceKind);
    const sourceSupportWarning = playbackError ?? likelyUnsupportedReason;
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
    const shouldShowCapabilityPanel = showCapabilities || playbackError !== null;
    // Is the floating mini-player currently showing this video?
    const isInMiniPlayer = miniEntry?.url === url && miniEntry?.postId === (postId ?? url);
    // When playing, watch intersection — if video scrolls off screen, send it to mini-player
    useEffect(() => {
        if (!isPlaying || isInMiniPlayer || !containerRef.current)
            return;
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry || entry.intersectionRatio >= 0.2)
                return;
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
        }, { threshold: [0, 0.2] });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [isPlaying, isInMiniPlayer, url, thumb, aspectRatio, postId, activate]);
    useEffect(() => {
        if (!autoplay || isInMiniPlayer)
            return;
        const v = videoRef.current;
        if (!v)
            return;
        v.play().catch(() => setIsPlaying(false));
    }, [autoplay, isInMiniPlayer]);
    useEffect(() => {
        return () => {
            const v = videoRef.current;
            if (!v)
                return;
            saveMediaPlaybackPrefs(mediaKey, {
                positionSeconds: v.currentTime,
                playbackRate: v.playbackRate,
            });
        };
    }, [mediaKey]);
    const formatTime = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0)
            return '0:00';
        const safeSeconds = Math.floor(seconds);
        const mins = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const seekBy = (delta) => {
        const v = videoRef.current;
        if (!v)
            return;
        const nextTime = Math.max(0, Math.min((duration || v.duration || 0), v.currentTime + delta));
        v.currentTime = nextTime;
        setCurrentTime(nextTime);
    };
    const togglePlay = () => {
        const v = videoRef.current;
        if (!v)
            return;
        if (v.paused) {
            v.play().catch(() => setIsPlaying(false));
            return;
        }
        v.pause();
    };
    const toggleMute = () => {
        const v = videoRef.current;
        if (!v)
            return;
        v.muted = !v.muted;
        setIsMuted(v.muted);
    };
    const handleSeek = (event) => {
        const v = videoRef.current;
        if (!v)
            return;
        const nextTime = Number(event.target.value);
        v.currentTime = nextTime;
        setCurrentTime(nextTime);
    };
    const enterFullscreen = () => {
        const node = containerRef.current;
        if (!node || !document.fullscreenEnabled)
            return;
        node.requestFullscreen().catch(() => { });
    };
    const handleRateChange = (event) => {
        const nextRate = Number(event.target.value);
        const v = videoRef.current;
        if (!v || !Number.isFinite(nextRate) || nextRate <= 0)
            return;
        v.playbackRate = nextRate;
        setPlaybackRate(nextRate);
        saveMediaPlaybackPrefs(mediaKey, { playbackRate: nextRate });
    };
    const handlePlaybackError = () => {
        const generic = 'This browser could not play the current video source.';
        setPlaybackError(likelyUnsupportedReason ?? generic);
        setShowCapabilities(true);
        setIsPlaying(false);
    };
    return (_jsxs("div", { ref: containerRef, style: {
            position: 'relative',
            paddingTop: `${(1 / aspectRatio) * 100}%`,
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: '#000',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }, children: [shouldShowCapabilityPanel && !isInMiniPlayer && (_jsxs("div", { style: {
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
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.02em' }, children: "Playback support" }), _jsxs("p", { style: { margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.74)' }, children: ["Current source: ", describeSourceKind(sourceKind), likelySourceSupport === true ? ' · likely supported' : '', likelySourceSupport === false ? ' · likely unsupported' : ''] })] }), _jsx("button", { type: "button", onClick: () => {
                                    setShowCapabilities(false);
                                    setPlaybackError(null);
                                }, style: {
                                    border: 'none',
                                    background: 'rgba(255,255,255,0.12)',
                                    color: '#fff',
                                    borderRadius: 999,
                                    padding: '4px 8px',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    fontWeight: 700,
                                }, children: "Hide" })] }), sourceSupportWarning && (_jsx("p", { style: { margin: '0 0 10px', fontSize: 12, lineHeight: 1.4, color: '#FFD7A8' }, children: sourceSupportWarning })), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', fontSize: 11 }, children: capabilityRows.map((row) => (_jsxs(React.Fragment, { children: [_jsx("span", { style: { color: 'rgba(255,255,255,0.82)' }, children: row.label }), _jsx("span", { style: { color: row.supported ? '#97F0C2' : 'rgba(255,255,255,0.62)', fontWeight: 700 }, children: describeSupportLevel(row.level) })] }, row.key))) })] })), thumb && (_jsx("img", { src: thumb, alt: "video thumbnail", style: {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    cursor: isInMiniPlayer ? 'default' : 'pointer',
                }, onClick: isInMiniPlayer ? undefined : () => setIsPlaying(true) })), isInMiniPlayer && (_jsxs("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.52)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                }, children: [_jsxs("svg", { width: "28", height: "28", viewBox: "0 0 24 24", fill: "none", stroke: "rgba(255,255,255,0.85)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("rect", { x: "2", y: "5", width: "20", height: "14", rx: "2" }), _jsx("rect", { x: "12", y: "11", width: "8", height: "6", rx: "1", fill: "rgba(255,255,255,0.85)", stroke: "none" })] }), _jsx("span", { style: {
                            color: 'rgba(255,255,255,0.75)',
                            fontSize: 11,
                            letterSpacing: 0.1,
                        }, children: "Playing in mini-player" })] })), !isInMiniPlayer && (_jsxs(_Fragment, { children: [_jsx("video", { ref: videoRef, src: url, autoPlay: autoplay, playsInline: true, preload: "metadata", style: {
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }, onClick: togglePlay, onCanPlay: () => setPlaybackError(null), onLoadedMetadata: (event) => {
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
                        }, onTimeUpdate: (event) => {
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
                        }, onPlay: () => setIsPlaying(true), onPause: (event) => {
                            setIsPlaying(false);
                            saveMediaPlaybackPrefs(mediaKey, {
                                positionSeconds: event.currentTarget.currentTime,
                                playbackRate: event.currentTarget.playbackRate,
                            });
                        }, onError: handlePlaybackError, onEnded: (event) => {
                            setIsPlaying(false);
                            saveMediaPlaybackPrefs(mediaKey, {
                                positionSeconds: 0,
                                playbackRate: event.currentTarget.playbackRate,
                            });
                        } }), !isPlaying && (_jsx("button", { onClick: togglePlay, style: {
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
                        }, "aria-label": "Play video", children: _jsx("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", children: _jsx("path", { d: "M8 5v14l11-7z", fill: "currentColor" }) }) })), _jsxs("div", { style: {
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            padding: '8px 10px 10px',
                            background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                        }, children: [_jsx("input", { type: "range", min: 0, max: duration > 0 ? duration : 0, step: 0.1, value: Math.min(currentTime, duration || currentTime), onChange: handleSeek, "aria-label": "Seek video", style: { width: '100%' } }), _jsxs("div", { style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [_jsx("button", { onClick: togglePlay, type: "button", "aria-label": isPlaying ? 'Pause video' : 'Play video', style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: isPlaying ? 'Pause' : 'Play' }), _jsx("button", { onClick: () => seekBy(-10), type: "button", "aria-label": "Rewind 10 seconds", style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: "-10s" }), _jsx("button", { onClick: () => seekBy(10), type: "button", "aria-label": "Forward 10 seconds", style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: "+10s" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [_jsxs("span", { style: { color: 'rgba(255,255,255,0.92)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }, children: [formatTime(currentTime), " / ", formatTime(duration)] }), _jsx("button", { onClick: toggleMute, type: "button", "aria-label": isMuted ? 'Unmute video' : 'Mute video', style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: isMuted ? 'Unmute' : 'Mute' }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.92)', fontSize: 11 }, children: ["Speed", _jsxs("select", { value: playbackRate, onChange: handleRateChange, "aria-label": "Video playback speed", style: { borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', padding: '3px 6px', cursor: 'pointer' }, children: [_jsx("option", { value: 0.75, children: "0.75x" }), _jsx("option", { value: 1, children: "1x" }), _jsx("option", { value: 1.25, children: "1.25x" }), _jsx("option", { value: 1.5, children: "1.5x" }), _jsx("option", { value: 2, children: "2x" })] })] }), _jsx("button", { onClick: enterFullscreen, type: "button", "aria-label": "Open fullscreen", style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: "Full" }), _jsx("button", { onClick: () => setShowCapabilities((prev) => !prev), type: "button", "aria-label": "Show playback formats", "aria-pressed": showCapabilities, style: { border: 'none', background: 'rgba(0,0,0,0.52)', color: '#fff', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }, children: "Formats" })] })] })] })] }))] }));
}
//# sourceMappingURL=VideoPlayer.js.map