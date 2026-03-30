import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── OverlayHost ───────────────────────────────────────────────────────────
// Renders all full-screen and sheet overlays in one place, driven by uiStore.
import React, { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUiStore } from '../store/uiStore.js';
import { markFeatureMounted, markFeatureOpen } from '../perf/prefetchTelemetry.js';
const ComposeSheet = React.lazy(() => import('../components/ComposeSheet.js'));
const StoryMode = React.lazy(() => import('../components/StoryMode.js'));
const SearchStoryScreen = React.lazy(() => import('../components/SearchStoryScreen.js'));
const PromptComposer = React.lazy(() => import('../components/PromptComposer.js'));
function MountTracker({ feature, moduleKey, children, }) {
    useEffect(() => {
        markFeatureMounted(feature, moduleKey);
    }, [feature, moduleKey]);
    return _jsx(_Fragment, { children: children });
}
export default function OverlayHost() {
    const { showCompose, closeCompose, showPromptComposer, closePromptComposer, story, closeStory, searchStoryQuery, closeSearchStory, openStory, } = useUiStore();
    const wasComposeOpenRef = useRef(false);
    const wasPromptOpenRef = useRef(false);
    const wasStoryOpenRef = useRef(false);
    const wasSearchOpenRef = useRef(false);
    useEffect(() => {
        if (showCompose && !wasComposeOpenRef.current)
            markFeatureOpen('compose');
        wasComposeOpenRef.current = showCompose;
    }, [showCompose]);
    useEffect(() => {
        if (showPromptComposer && !wasPromptOpenRef.current)
            markFeatureOpen('promptComposer');
        wasPromptOpenRef.current = showPromptComposer;
    }, [showPromptComposer]);
    useEffect(() => {
        const isOpen = !!story;
        if (isOpen && !wasStoryOpenRef.current)
            markFeatureOpen('storyMode');
        wasStoryOpenRef.current = isOpen;
    }, [story]);
    useEffect(() => {
        const isOpen = !!searchStoryQuery;
        if (isOpen && !wasSearchOpenRef.current)
            markFeatureOpen('searchStory');
        wasSearchOpenRef.current = isOpen;
    }, [searchStoryQuery]);
    return (_jsxs(_Fragment, { children: [_jsx(AnimatePresence, { children: showCompose && (_jsx(React.Suspense, { fallback: null, children: _jsx(MountTracker, { feature: "compose", moduleKey: "compose-sheet", children: _jsx(ComposeSheet, { onClose: closeCompose }) }) })) }), _jsx(AnimatePresence, { children: showPromptComposer && (_jsx(React.Suspense, { fallback: null, children: _jsx(MountTracker, { feature: "promptComposer", moduleKey: "prompt-composer", children: _jsx(PromptComposer, { onClose: closePromptComposer, onPosted: closePromptComposer }) }) })) }), _jsx(AnimatePresence, { children: story && (_jsx(React.Suspense, { fallback: null, children: _jsx(MountTracker, { feature: "storyMode", moduleKey: "story-mode", children: _jsx(StoryMode, { entry: story, onClose: closeStory }) }) })) }), _jsx(AnimatePresence, { children: searchStoryQuery && (_jsx(React.Suspense, { fallback: null, children: _jsx(MountTracker, { feature: "searchStory", moduleKey: "search-story", children: _jsx(SearchStoryScreen, { query: searchStoryQuery, onClose: closeSearchStory, onOpenStory: openStory }) }) })) })] }));
}
//# sourceMappingURL=OverlayHost.js.map