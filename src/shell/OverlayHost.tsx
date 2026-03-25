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

function MountTracker({
  feature,
  moduleKey,
  children,
}: {
  feature: 'compose' | 'promptComposer' | 'storyMode' | 'searchStory';
  moduleKey: 'compose-sheet' | 'prompt-composer' | 'story-mode' | 'search-story';
  children: React.ReactNode;
}) {
  useEffect(() => {
    markFeatureMounted(feature, moduleKey);
  }, [feature, moduleKey]);

  return <>{children}</>;
}

export default function OverlayHost() {
  const {
    showCompose, closeCompose,
    showPromptComposer, closePromptComposer,
    story, closeStory,
    searchStoryQuery, closeSearchStory,
    openStory,
  } = useUiStore();

  const wasComposeOpenRef = useRef(false);
  const wasPromptOpenRef = useRef(false);
  const wasStoryOpenRef = useRef(false);
  const wasSearchOpenRef = useRef(false);

  useEffect(() => {
    if (showCompose && !wasComposeOpenRef.current) markFeatureOpen('compose');
    wasComposeOpenRef.current = showCompose;
  }, [showCompose]);

  useEffect(() => {
    if (showPromptComposer && !wasPromptOpenRef.current) markFeatureOpen('promptComposer');
    wasPromptOpenRef.current = showPromptComposer;
  }, [showPromptComposer]);

  useEffect(() => {
    const isOpen = !!story;
    if (isOpen && !wasStoryOpenRef.current) markFeatureOpen('storyMode');
    wasStoryOpenRef.current = isOpen;
  }, [story]);

  useEffect(() => {
    const isOpen = !!searchStoryQuery;
    if (isOpen && !wasSearchOpenRef.current) markFeatureOpen('searchStory');
    wasSearchOpenRef.current = isOpen;
  }, [searchStoryQuery]);

  return (
    <>
      {/* Standard compose sheet */}
      <AnimatePresence>
        {showCompose && (
          <React.Suspense fallback={null}>
            <MountTracker feature="compose" moduleKey="compose-sheet">
              <ComposeSheet onClose={closeCompose} />
            </MountTracker>
          </React.Suspense>
        )}
      </AnimatePresence>

      {/* Prompt composer — Hosted Thread creation */}
      <AnimatePresence>
        {showPromptComposer && (
          <React.Suspense fallback={null}>
            <MountTracker feature="promptComposer" moduleKey="prompt-composer">
              <PromptComposer
                onClose={closePromptComposer}
                onPosted={closePromptComposer}
              />
            </MountTracker>
          </React.Suspense>
        )}
      </AnimatePresence>

      {/* Hosted Thread — Discussion Mode */}
      <AnimatePresence>
        {story && (
          <React.Suspense fallback={null}>
            <MountTracker feature="storyMode" moduleKey="story-mode">
              <StoryMode entry={story} onClose={closeStory} />
            </MountTracker>
          </React.Suspense>
        )}
      </AnimatePresence>

      {/* Search Story — Discovery Mode card deck */}
      <AnimatePresence>
        {searchStoryQuery && (
          <React.Suspense fallback={null}>
            <MountTracker feature="searchStory" moduleKey="search-story">
              <SearchStoryScreen
                query={searchStoryQuery}
                onClose={closeSearchStory}
                onOpenStory={openStory}
              />
            </MountTracker>
          </React.Suspense>
        )}
      </AnimatePresence>
    </>
  );
}
