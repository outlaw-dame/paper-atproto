import React from 'react';
export interface MiniPlayerEntry {
    url: string;
    thumb?: string;
    aspectRatio: number;
    startTime: number;
    /** ID of the post this video belongs to, for future scroll-back support */
    postId: string;
}
interface MiniPlayerContextValue {
    entry: MiniPlayerEntry | null;
    activate: (entry: MiniPlayerEntry) => void;
    dismiss: () => void;
}
export declare function MiniPlayerProvider({ children }: {
    children: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function useMiniPlayer(): MiniPlayerContextValue;
export {};
//# sourceMappingURL=MiniPlayerContext.d.ts.map