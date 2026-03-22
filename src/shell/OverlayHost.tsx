// ─── OverlayHost ───────────────────────────────────────────────────────────
// Renders all full-screen and sheet overlays in one place, driven by uiStore.
// This keeps App.tsx clean and makes it trivial to add new overlay types.

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUiStore } from '../store/uiStore';
import ComposeSheet from '../components/ComposeSheet';
import StoryMode from '../components/StoryMode';

export default function OverlayHost() {
  const { showCompose, closeCompose, story, closeStory } = useUiStore();

  return (
    <>
      <AnimatePresence>
        {showCompose && <ComposeSheet onClose={closeCompose} />}
      </AnimatePresence>

      <AnimatePresence>
        {story && <StoryMode entry={story} onClose={closeStory} />}
      </AnimatePresence>
    </>
  );
}
