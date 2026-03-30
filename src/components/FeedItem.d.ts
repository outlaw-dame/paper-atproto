import React from 'react';
interface FeedItemProps {
    post: {
        id: string;
        author: {
            handle: string;
            displayName?: string;
            avatar?: string;
        };
        content: string;
        createdAt: string;
        embed?: any;
        entities?: any[];
    };
    onClick?: () => void;
}
/**
 * An immersive feed item component inspired by Facebook Paper.
 * Uses Konsta UI for the base and Framer Motion for subtle animations.
 */
export declare const FeedItem: React.FC<FeedItemProps>;
export {};
//# sourceMappingURL=FeedItem.d.ts.map