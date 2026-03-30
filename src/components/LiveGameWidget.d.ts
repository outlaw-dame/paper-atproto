import React from 'react';
import type { LiveGame } from '../sports/types.js';
interface LiveGameWidgetProps {
    game: LiveGame;
    onClick?: () => void;
    compact?: boolean;
}
/**
 * Live Game Widget Component
 * Displays real-time score, status, and live indicator for sports games
 * Can be embedded in feed or displayed standalone
 */
export declare const LiveGameWidget: React.FC<LiveGameWidgetProps>;
export default LiveGameWidget;
//# sourceMappingURL=LiveGameWidget.d.ts.map