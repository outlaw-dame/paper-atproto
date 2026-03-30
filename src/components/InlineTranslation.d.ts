/**
 * InlineTranslation — shared inline translation component.
 *
 * Handles all translation UX for a single piece of text:
 *  - Manual translate trigger (when language differs)
 *  - Auto-translate on mount (when autoTranslate=true)
 *  - Animated attribution strip: "Translated from French · Show original · ×"
 *  - Auto-translate error retry
 *
 * Used by PostCard, StoryMode, and ExploreTab to avoid three separate implementations.
 */
import React from 'react';
export declare function TranslateIcon({ size, color, }: {
    size?: number;
    color?: string;
}): import("react/jsx-runtime").JSX.Element;
export interface InlineTranslationProps {
    postId: string;
    sourceText: string;
    /** Pre-detected language code. 'und' = unknown/mixed. */
    sourceLang?: string;
    targetLang: string;
    /**
     * When true, translation is triggered automatically on mount without user
     * interaction (inline translate / auto-translate for short posts).
     */
    autoTranslate?: boolean;
    localOnlyMode?: boolean;
    /**
     * When false, the manual "Translate" button is hidden.
     * The attribution strip still appears if a translation is cached.
     * Defaults to true.
     */
    showTrigger?: boolean;
    /** Render function receives the (possibly translated) text. */
    renderText: (text: string) => React.ReactNode;
}
export default function InlineTranslation({ postId, sourceText, sourceLang, targetLang, autoTranslate, localOnlyMode, showTrigger, renderText, }: InlineTranslationProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=InlineTranslation.d.ts.map