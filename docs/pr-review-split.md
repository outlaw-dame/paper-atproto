# PR Review Split

Use this review split for the current large PR with algorithm-layer integration and strictness hardening.

## PR Summary

- Branch: `codex-interpretive-confidence-runtime`
- Commit: `f515f32`
- Focus: algorithmic decision layer integration, reliability/safety hardening, strict typing cleanups, and broad conversation/media/search updates

## Reviewer Lane 1: Algorithmic Decision Layer

- Scope:
  - Production algorithm modules and deterministic scoring behavior
  - Integration into writer input, thread pipeline, and change interpolation
  - Fallback behavior when data is partial or malformed
- Key files:
  - `src/intelligence/algorithms/changeDetection.ts`
  - `src/intelligence/algorithms/contributorSelection.ts`
  - `src/intelligence/algorithms/entityCentrality.ts`
  - `src/intelligence/algorithms/stanceClustering.ts`
  - `src/intelligence/writerInput.ts`
  - `src/intelligence/updateInterpolatorState.ts`
  - `src/intelligence/threadPipeline.ts`
  - `src/intelligence/changeDetection.ts`
  - `src/intelligence/contributorSelection.ts`
  - `src/intelligence/redundancy.ts`
- Review questions:
  - Are scores bounded and deterministic for identical inputs?
  - Do algorithm fallbacks fail closed without crashing the writer path?
  - Is ranking behavior stable under sparse entity/sentiment signals?
- Validation:
  - Run focused tests for intelligence modules
  - Run app flows that trigger thread interpolation and compose guidance
  - Confirm unchanged behavior for low-signal threads

## Reviewer Lane 2: Type Safety, Auth, and Client Stability

- Scope:
  - Strict TypeScript fixes affecting auth/session/client code
  - Optional-field correctness under `exactOptionalPropertyTypes`
  - Runtime stability around OAuth/agent state and query error paths
- Key files:
  - `src/atproto/AtpContext.tsx`
  - `src/atproto/oauthClient.ts`
  - `src/lib/atproto/errors.ts`
  - `src/lib/atproto/queries.ts`
  - `src/components/ComposeSheet.tsx`
  - `src/components/ContextPost.tsx`
  - `src/components/StoryMode.tsx`
  - `src/shell/OverlayHost.tsx`
- Review questions:
  - Are optional props omitted correctly instead of passing `undefined`?
  - Are auth/session transitions resilient to partial agent state?
  - Do error paths avoid leaking sensitive internals to UI logs/messages?
- Validation:
  - Run `npx tsc --noEmit`
  - Exercise login/logout and story/context render transitions
  - Verify no unhandled promise rejections in auth and query flows

## Reviewer Lane 3: Safety, Privacy, and Moderation

- Scope:
  - Input sanitation and sensitive content handling in affected surfaces
  - Moderation/safety-adjacent changes in feed/story/search/media paths
  - Data minimization and telemetry boundaries
- Key files:
  - `src/lib/sentiment.ts`
  - `src/lib/hashtags/hashtagInsights.ts`
  - `src/search.ts`
  - `src/schema.ts`
  - `src/sync.ts`
  - `src/intelligence/mediaInput.ts`
  - `src/lib/media/extractMediaSignals.ts`
  - `src/perf/multimodalTelemetry.ts`
- Review questions:
  - Are external/user-provided values normalized and bounded before ranking/use?
  - Is potentially sensitive data excluded from telemetry/log payloads?
  - Do moderation pathways degrade safely when enrichment fails?
- Validation:
  - Run search/moderation regression tests where available
  - Smoke test media + hashtag + search flows for malformed input
  - Verify telemetry payloads contain no raw sensitive text where avoidable

## Reviewer Lane 4: Docs, Rollout, and Operational Readiness

- Scope:
  - Algorithm docs/roadmap consistency with implementation
  - Rollout guidance, guardrails, and operator-facing notes
  - PR scoping and staged merge strategy
- Key files:
  - `ALGORITHM_INTEGRATION_GUIDE.md`
  - `ALGORITHM_LAYER_PLAN.md`
  - `ALGORITHM_QUICK_START.md`
  - `ALGORITHM_ROADMAP.md`
  - `MULTIMODAL_SEARCH_ANALYSIS.md`
  - `docs/pr-review-split.md`
- Review questions:
  - Do roadmap phases map to concrete shipped code paths?
  - Are known gaps and risk mitigations called out explicitly?
  - Is rollback guidance clear if behavior regresses in production?
- Validation:
  - Cross-check docs against implemented modules and integrations
  - Confirm review checklist covers top-risk runtime and privacy scenarios

## Suggested Review Order

1. Lane 1 first, because algorithm correctness is the core feature objective.
2. Lane 2 second, because strictness/auth regressions can block basic app usability.
3. Lane 3 third, because safety/privacy guarantees must hold across new signals.
4. Lane 4 last, for alignment and release confidence.

## Pasteable PR Comment

```md
Suggested review split for this PR:

1. Algorithmic decision layer: scoring logic, determinism, and fallback behavior
2. Type safety + auth/client stability: strict optional handling and session transitions
3. Safety/privacy/moderation: sanitation, telemetry boundaries, and fail-safe behavior
4. Docs/rollout: roadmap-to-code mapping, risks, and release guardrails
```