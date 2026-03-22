// ─── OverlayHost ───────────────────────────────────────────────────────────
// Renders all full-screen and sheet overlays in one place, driven by uiStore.

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUiStore } from '../store/uiStore';
import ComposeSheet from '../components/ComposeSheet';
import StoryMode from '../components/StoryMode';
import SearchStoryScreen from '../components/SearchStoryScreen';
import PromptComposer from '../components/PromptComposer';

export default function OverlayHost() {
  const {
    showCompose, closeCompose,
    showPromptComposer, closePromptComposer,
    story, closeStory,
    searchStoryQuery, closeSearchStory,
    openStory,
  } = useUiStore();

  return (
    <>
      {/* Standard compose sheet */}
      <AnimatePresence>
        {showCompose && <ComposeSheet onClose={closeCompose} />}
      </AnimatePresence>

      {/* Prompt composer — Hosted Thread creation */}
      <AnimatePresence>
        {showPromptComposer && (
          <PromptComposer
            onClose={closePromptComposer}
            onPosted={closePromptComposer}
          />
        )}
      </AnimatePresence>

      {/* Hosted Thread — Discussion Mode */}
      <AnimatePresence>
        {story && <StoryMode entry={story} onClose={closeStory} />}
      </AnimatePresence>

      {/* Search Story — Discovery Mode card deck */}
      <AnimatePresence>
        {searchStoryQuery && (
          <SearchStoryScreen
            query={searchStoryQuery}
            onClose={closeSearchStory}
            onOpenStory={openStory}
          />
        )}
      </AnimatePresence>
    </>
  );
}
