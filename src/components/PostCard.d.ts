import type { MockPost } from '../data/mockData';
import type { TimelineConversationHint } from '../conversation/projections/timelineProjection.js';
interface PostCardProps {
    post: MockPost;
    onOpenStory: (entry: any) => void;
    onViewProfile?: (handle: string) => void;
    onToggleRepost?: (post: MockPost) => void;
    onToggleLike?: (post: MockPost) => void;
    onQuote?: (post: MockPost) => void;
    onReply?: (post: MockPost) => void;
    onBookmark?: (post: MockPost) => void;
    onMore?: (post: MockPost) => void;
    index: number;
    timelineHint?: TimelineConversationHint;
    /** Handle of the post being replied to — shown as "↳ Replying to @handle" when no ContextPost is visible */
    replyingTo?: string | undefined;
    /** When true, draws a connector line entering from the top of the card to the avatar, bridging a ContextPost above */
    hasContextAbove?: boolean;
}
export default function PostCard({ post, onOpenStory, onViewProfile, onToggleRepost, onToggleLike, onQuote, onReply, onBookmark, onMore, index, timelineHint, replyingTo, hasContextAbove }: PostCardProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=PostCard.d.ts.map