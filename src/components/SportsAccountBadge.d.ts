import React from 'react';
interface OfficialSportsBadgeProps {
    authorDid: string;
    size?: 'small' | 'medium' | 'large';
}
/**
 * Official Sports Account Badge Component
 * Displays verification badge for official league/team accounts
 */
export declare const OfficialSportsBadge: React.FC<OfficialSportsBadgeProps>;
interface SportsAccountBadgeProps {
    authorDid: string;
    authorHandle: string;
    hideIfNotOfficial?: boolean;
}
/**
 * Sports Account Badge with Label
 * Shows "Official League" or "Official Team" text with icon
 */
export declare const SportsAccountBadge: React.FC<SportsAccountBadgeProps>;
interface SportsPostIndicatorProps {
    postType: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
    isLive?: boolean;
    hasVideo?: boolean;
}
/**
 * Visual indicator for sports post type
 */
export declare const SportsPostIndicator: React.FC<SportsPostIndicatorProps>;
interface SportsPostMetadataProps {
    relatedGames?: string[];
    postType?: 'score-update' | 'commentary' | 'highlight' | 'analysis' | 'prediction' | 'reaction';
    isLive?: boolean;
    authorDid?: string;
}
/**
 * Composite sports metadata display for posts
 */
export declare const SportsPostMetadata: React.FC<SportsPostMetadataProps>;
export default OfficialSportsBadge;
//# sourceMappingURL=SportsAccountBadge.d.ts.map