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
export default function VideoPlayer({ url, thumb, aspectRatio, autoplay, postId }: VideoPlayerProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=VideoPlayer.d.ts.map