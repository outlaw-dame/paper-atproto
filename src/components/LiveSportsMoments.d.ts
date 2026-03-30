import React from 'react';
import type { LiveGame } from '../sports/types.js';
interface LiveSportsMomentsProps {
    maxGames?: number;
    onGameClick?: (gameId: string) => void;
    compact?: boolean;
}
/**
 * Live Sports Moments Section
 * Displays active games and sports highlighting in feed
 */
export declare const LiveSportsMoments: React.FC<LiveSportsMomentsProps>;
interface SportsMomentItemProps {
    post: any;
    game?: LiveGame;
}
/**
 * Individual sports moment post display
 * Shows post with associated live game context
 */
export declare const SportsMomentItem: React.FC<SportsMomentItemProps>;
/**
 * Sports Moments Feed Section
 * High-priority display for live game updates and sports commentary
 */
export declare const SportsMomentsFeed: React.FC<{
    posts: any[];
}>;
export default LiveSportsMoments;
//# sourceMappingURL=LiveSportsMoments.d.ts.map