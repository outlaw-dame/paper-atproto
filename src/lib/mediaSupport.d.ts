export type SupportLevel = '' | 'maybe' | 'probably';
export interface VideoFormatSupport {
    key: string;
    label: string;
    mimeType: string;
    level: SupportLevel;
    supported: boolean;
}
export interface VideoPlaybackCapabilities {
    hls: VideoFormatSupport;
    mp4: VideoFormatSupport;
    mp4H264Aac: VideoFormatSupport;
    mp4HevcAac: VideoFormatSupport;
    mp4Av1Aac: VideoFormatSupport;
    webm: VideoFormatSupport;
    webmVp9Opus: VideoFormatSupport;
    webmVp8Vorbis: VideoFormatSupport;
}
export type VideoSourceKind = 'hls' | 'mp4' | 'webm' | 'unknown';
export declare function getVideoPlaybackCapabilities(): VideoPlaybackCapabilities;
export declare function detectVideoSourceKind(url: string): VideoSourceKind;
export declare function getLikelySourceSupport(capabilities: VideoPlaybackCapabilities, sourceKind: VideoSourceKind): boolean | null;
export declare function describeSupportLevel(level: SupportLevel): string;
export declare function describeSourceKind(sourceKind: VideoSourceKind): string;
export declare function getLikelyUnsupportedReason(capabilities: VideoPlaybackCapabilities, sourceKind: VideoSourceKind): string | null;
//# sourceMappingURL=mediaSupport.d.ts.map