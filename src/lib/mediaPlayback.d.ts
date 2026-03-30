export interface MediaPlaybackPrefs {
    positionSeconds?: number;
    playbackRate?: number;
    updatedAt: number;
}
export declare function getMediaPlaybackPrefs(mediaKey: string): MediaPlaybackPrefs | null;
export declare function saveMediaPlaybackPrefs(mediaKey: string, update: {
    positionSeconds?: number;
    playbackRate?: number;
}): void;
//# sourceMappingURL=mediaPlayback.d.ts.map