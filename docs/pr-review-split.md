# PR Review Split

Use this plan to split review for large cross-cutting PRs.

## PR Summary

- Branch: `codex-interpretive-confidence-runtime`
- Commit: `2459088`
- Focus: thread overlay stability, media transcription/captions, conversation intelligence/discovery, and test coverage expansion

## Reviewer Lane 1: Frontend Thread Rendering

- Scope:
  - Thread overlay stability
  - `StoryMode` hydration and render safety
  - Overlay error handling and diagnostics
- Key files:
  - `src/components/StoryMode.tsx`
  - `src/shell/OverlayHost.tsx`
  - `src/components/PostCard.tsx`
  - `src/components/FeedItem.tsx`
  - `src/components/FeedList.tsx`
  - `src/components/ContextPost.tsx`
- Review questions:
  - Are all thread-view hydration paths null-safe?
  - Does the overlay error boundary recover cleanly when switching stories?
  - Are any new diagnostics exposing more detail than intended for end users?
- Validation:
  - Open multiple threads in sequence
  - Re-open the same thread after closing it
  - Confirm no render fallback appears for normal threads

## Reviewer Lane 2: Media Transcription And Captions

- Scope:
  - Media transcription route and worker bridge
  - Caption generation client flow
  - Caption playback/rendering in video surfaces
- Key files:
  - `server/src/routes/media.ts`
  - `server/src/services/media/transcriptionWorkerBridge.ts`
  - `server/scripts/transcription_worker.py`
  - `src/lib/media/transcriptionClient.ts`
  - `src/lib/media/captionButtonState.ts`
  - `src/components/ComposeSheet.tsx`
  - `src/components/VideoPlayer.tsx`
  - `src/atproto/mappers.ts`
  - `src/server/mediaRoute.integration.test.ts`
  - `src/lib/media/captionButtonState.test.ts`
- Review questions:
  - Is the route contract stable and minimal?
  - Are language handling and button state transitions correct?
  - Does caption attachment/playback align with the embed model?
- Validation:
  - Run the media route integration test
  - Run the caption button state test
  - Generate captions for a video and verify playback

## Reviewer Lane 3: Conversation Intelligence And Discovery

- Scope:
  - Session hydration and mutation flow
  - Projection logic for story/thread/timeline/composer
  - Discovery, embedding, entity linking, and recommendation changes
- Key files:
  - `src/conversation/sessionHydration.ts`
  - `src/conversation/sessionMutations.ts`
  - `src/conversation/sessionSelectors.ts`
  - `src/conversation/sessionAssembler.ts`
  - `src/conversation/projections/storyProjection.ts`
  - `src/conversation/projections/threadProjection.ts`
  - `src/conversation/projections/timelineProjection.ts`
  - `src/conversation/projections/composerProjection.ts`
  - `src/conversation/discovery/`
  - `src/intelligence/embeddingPipeline.ts`
  - `src/intelligence/entityLinking.ts`
  - `src/intelligence/routing.ts`
- Review questions:
  - Do projection outputs stay coherent under hydration updates?
  - Are mutation and selector changes preserving expected session behavior?
  - Are discovery/recommendation additions scoped correctly and testable?
- Validation:
  - Run conversation projection and hydration tests
  - Run entity-linking and embedding pipeline tests
  - Smoke-test discovery/search surfaces in the app

## Reviewer Lane 4: QA, Tooling, And Dev Workflow

- Scope:
  - Tunnel/dev workflow
  - Build/test ergonomics
  - Supporting docs and scripts
- Key files:
  - `scripts/tunnel.sh`
  - `scripts/benchmark_compression.mjs`
  - `scripts/eval_hard_negatives.mjs`
  - `scripts/vite/precompressPlugin.ts`
  - `vite.config.ts`
  - `vitest.config.ts`
  - `docs/compression-deployment.md`
  - `docs/gemini-integration-opportunities.md`
- Review questions:
  - Does the tunnel workflow remain reliable for OAuth/dev testing?
  - Do config/tooling changes have unintended side effects on normal dev flow?
  - Are new docs aligned with the actual implementation state?
- Validation:
  - Run `npm run build`
  - Smoke-test the tunnel flow and sign-in path
  - Confirm targeted tests still pass locally

## Suggested Review Order

1. Reviewer Lane 1 first, because thread rendering regressions block core app usage.
2. Reviewer Lane 2 second, because it introduces new server/client contract surface.
3. Reviewer Lane 3 third, because it is the largest logic area and benefits from stabilized UI assumptions.
4. Reviewer Lane 4 last, for final validation and workflow confidence.

## Pasteable PR Comment

```md
Suggested review split:

1. Frontend thread rendering: `StoryMode`, overlay recovery, thread-view crash handling
2. Media transcription/captions: server media route, worker bridge, compose/playback caption flows
3. Conversation intelligence/discovery: hydration, mutations, projections, embedding/entity-linking
4. QA/tooling/docs: tunnel flow, build/test config, supporting scripts and docs
```