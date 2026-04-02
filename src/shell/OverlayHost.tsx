// ─── OverlayHost ───────────────────────────────────────────────────────────
// Renders all full-screen and sheet overlays in one place, driven by uiStore.

import React, { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUiStore } from '../store/uiStore';
import { markFeatureMounted, markFeatureOpen } from '../perf/prefetchTelemetry';

const ComposeSheet = React.lazy(() => import('../components/ComposeSheet'));
const StoryMode = React.lazy(() => import('../components/StoryMode'));
const SearchStoryScreen = React.lazy(() => import('../components/SearchStoryScreen'));
const HashtagFeed = React.lazy(() => import('../components/HashtagFeed'));
const PeopleFeed = React.lazy(() => import('../components/PeopleFeed'));
const PromptComposer = React.lazy(() => import('../components/PromptComposer'));

function MountTracker({
  feature,
  moduleKey,
  children,
}: {
  feature: 'compose' | 'promptComposer' | 'storyMode' | 'searchStory' | 'hashtagFeed' | 'peopleFeed';
  moduleKey: 'compose-sheet' | 'prompt-composer' | 'story-mode' | 'search-story' | 'hashtag-feed' | 'people-feed';
  children: React.ReactNode;
}) {
  useEffect(() => {
    markFeatureMounted(feature, moduleKey);
  }, [feature, moduleKey]);

  return <>{children}</>;
}

type OverlayErrorBoundaryProps = {
  resetKey: string;
  fallback: React.ReactNode | ((errorMessage?: string) => React.ReactNode);
  children: React.ReactNode;
};

type OverlayErrorBoundaryState = {
  hasError: boolean;
  errorMessage?: string;
  lastResetKey?: string;
};

class OverlayErrorBoundary extends React.Component<
  OverlayErrorBoundaryProps,
  OverlayErrorBoundaryState
> {
  state: OverlayErrorBoundaryState = {
    hasError: false,
    lastResetKey: this.props.resetKey,
  };

  static getDerivedStateFromProps(
    props: OverlayErrorBoundaryProps,
    state: OverlayErrorBoundaryState,
  ): Partial<OverlayErrorBoundaryState> | null {
    if (props.resetKey !== state.lastResetKey) {
      return {
        hasError: false,
        lastResetKey: props.resetKey,
      };
    }
    return null;
  }

  static getDerivedStateFromError(): Partial<OverlayErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.setState({ errorMessage });
    console.error('[OverlayHost] overlay render failed', error);
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.errorMessage);
      }
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function OverlayErrorFallback({
  title,
  body,
  onClose,
  details,
}: {
  title: string;
  body: string;
  onClose: () => void;
  details?: string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(6, 10, 17, 0.58)',
        backdropFilter: 'blur(18px)',
        zIndex: 10000,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'color-mix(in srgb, var(--surface) 88%, #0b1526 12%)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.3)',
          padding: '22px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--type-ui-title-md-size)', lineHeight: 'var(--type-ui-title-md-line)', letterSpacing: 'var(--type-ui-title-md-track)', color: 'var(--label-1)' }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-line)', letterSpacing: 'var(--type-body-sm-track)', color: 'var(--label-3)' }}>
            {body}
          </p>
          {details ? (
            <p style={{
              margin: 0,
              padding: '8px 10px',
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--surface) 80%, #241217 20%)',
              border: '1px solid color-mix(in srgb, var(--sep) 85%, #ff6b6b 15%)',
              color: 'var(--label-2)',
              fontSize: 'var(--type-meta-sm-size)',
              lineHeight: 'var(--type-meta-sm-line)',
              wordBreak: 'break-word',
            }}>
              {`Error: ${details}`}
            </p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          style={{
            appearance: 'none',
            border: '1px solid color-mix(in srgb, var(--blue) 24%, var(--sep))',
            background: 'var(--blue)',
            color: '#fff',
            borderRadius: 14,
            minHeight: 44,
            padding: '10px 16px',
            font: 'inherit',
            fontWeight: 700,
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function OverlayHost() {
  const {
    showCompose, closeCompose,
    showPromptComposer, closePromptComposer,
    story, closeStory,
    searchStoryQuery, closeSearchStory,
    hashtagFeedQuery, closeHashtagFeed,
    peopleFeedQuery, closePeopleFeed,
    openStory,
    replyTarget,
  } = useUiStore();

  const wasComposeOpenRef = useRef(false);
  const wasPromptOpenRef = useRef(false);
  const wasStoryOpenRef = useRef(false);
  const wasSearchOpenRef = useRef(false);
  const wasHashtagOpenRef = useRef(false);
  const wasPeopleOpenRef = useRef(false);

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

  useEffect(() => {
    const isOpen = !!hashtagFeedQuery;
    if (isOpen && !wasHashtagOpenRef.current) markFeatureOpen('hashtagFeed');
    wasHashtagOpenRef.current = isOpen;
  }, [hashtagFeedQuery]);

  useEffect(() => {
    const isOpen = !!peopleFeedQuery;
    if (isOpen && !wasPeopleOpenRef.current) markFeatureOpen('peopleFeed');
    wasPeopleOpenRef.current = isOpen;
  }, [peopleFeedQuery]);

  return (
    <>
      {/* Standard compose sheet */}
      <AnimatePresence>
        {showCompose && (
          <OverlayErrorBoundary
            resetKey={`compose:${replyTarget?.id ?? 'new'}`}
            fallback={(
              <OverlayErrorFallback
                title="Reply composer unavailable"
                body="The compose sheet hit a render problem. Close it and try again without losing the rest of the app."
                onClose={closeCompose}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="compose" moduleKey="compose-sheet">
                <ComposeSheet onClose={closeCompose} />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>

      {/* Prompt composer — Hosted Thread creation */}
      <AnimatePresence>
        {showPromptComposer && (
          <OverlayErrorBoundary
            resetKey={`promptComposer:${showPromptComposer ? 'open' : 'closed'}`}
            fallback={(
              <OverlayErrorFallback
                title="Prompt composer unavailable"
                body="The hosted-thread composer hit a render problem. Close it and retry after the app settles."
                onClose={closePromptComposer}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="promptComposer" moduleKey="prompt-composer">
                <PromptComposer
                  onClose={closePromptComposer}
                  onPosted={closePromptComposer}
                />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>

      {/* Hosted Thread — Discussion Mode */}
      <AnimatePresence>
        {story && (
          <OverlayErrorBoundary
            resetKey={`story:${story.id}`}
            fallback={(errorMessage) => (
              <OverlayErrorFallback
                title="Thread view unavailable"
                body="This thread hit a render problem. Close it and try opening the post again."
                {...(errorMessage ? { details: errorMessage } : {})}
                onClose={closeStory}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="storyMode" moduleKey="story-mode">
                <StoryMode entry={story} onClose={closeStory} />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>

      {/* Search Story — Discovery Mode card deck */}
      <AnimatePresence>
        {searchStoryQuery && (
          <OverlayErrorBoundary
            resetKey={`search:${searchStoryQuery}`}
            fallback={(
              <OverlayErrorFallback
                title="Search story unavailable"
                body="Discovery mode hit a render problem. Close it and try the search again."
                onClose={closeSearchStory}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="searchStory" moduleKey="search-story">
                <SearchStoryScreen
                  query={searchStoryQuery}
                  onClose={closeSearchStory}
                  onOpenStory={openStory}
                />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>

      {/* Hashtag Feed */}
      <AnimatePresence>
        {hashtagFeedQuery && (
          <OverlayErrorBoundary
            resetKey={`hashtag:${hashtagFeedQuery}`}
            fallback={(
              <OverlayErrorFallback
                title="Hashtag feed unavailable"
                body="The hashtag feed hit a render problem. Close it and try again."
                onClose={closeHashtagFeed}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="hashtagFeed" moduleKey="hashtag-feed">
                <HashtagFeed hashtag={hashtagFeedQuery} />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>

      {/* People Feed */}
      <AnimatePresence>
        {peopleFeedQuery && (
          <OverlayErrorBoundary
            resetKey={`people:${peopleFeedQuery}`}
            fallback={(
              <OverlayErrorFallback
                title="People feed unavailable"
                body="The people search hit a render problem. Close it and try again."
                onClose={closePeopleFeed}
              />
            )}
          >
            <React.Suspense fallback={null}>
              <MountTracker feature="peopleFeed" moduleKey="people-feed">
                <PeopleFeed query={peopleFeedQuery} />
              </MountTracker>
            </React.Suspense>
          </OverlayErrorBoundary>
        )}
      </AnimatePresence>
    </>
  );
}
