# Coordinator runtime extraction plan

This document defines the safe path for extracting a first-class coordinator runtime from the current conversation session orchestration. It is intentionally a plan before a runtime rewrite.

## Current state

`src/conversation/sessionAssembler.ts` is the current orchestration boundary. It already performs coordinator-like work:

- thread fetch and retry handling
- deterministic verified-thread pipeline execution
- session graph assembly
- moderation/user-rule redaction
- mental-health crisis scan
- conversation quality annotation
- interpretive confidence application
- delta-decision finalization
- continuity snapshot update
- shadow supervisor application
- model source-token creation
- writer, multimodal, and premium model gating
- async freshness checks before applying model results
- stale result discard accounting
- model run diagnostics updates
- writer input translation
- media analysis planning and execution
- premium request assembly and redaction

Because this file owns many side effects, extraction must be staged. A broad rewrite would risk stale-state bugs, duplicated execution, privacy regressions, or loss of model-output freshness checks.

## Non-negotiable invariants

Any coordinator extraction must preserve these behaviors:

1. **Source-token freshness:** async writer, multimodal, and premium results must only apply when the current session still matches the source token.
2. **Stale-result discard accounting:** stale outputs must continue to increment discard diagnostics rather than silently applying or disappearing.
3. **Local-only/privacy behavior:** local-only mode and user content-filter redaction must remain intact before remote or premium model requests.
4. **No duplicate execution:** extraction must not cause writer, multimodal, premium, or translation paths to run twice for one hydration cycle.
5. **No provider secrets in browser code:** browser/client paths must not gain secret-bearing provider configuration.
6. **Abort propagation:** existing abort behavior must remain wired through thread fetch, verification pipeline, translation, media, writer, and premium calls where applicable.
7. **Fail-soft behavior:** media and premium failures must degrade gracefully without breaking base session hydration.
8. **Mental-health scan remains non-optional:** safety scan must continue to run independently of interpolator enablement.
9. **User filter redaction remains pre-provider:** user-rule redaction must happen before premium/model requests that can leave the local device.
10. **No planner/coordinator naming drift:** provider planners remain planners; the coordinator is the broader runtime supervisor.

## Extraction boundary

The future coordinator should not own low-level UI store mechanics forever, but the first extraction should avoid changing behavior.

Initial boundary:

```txt
hydrateConversationSession
  -> fetch and build canonical session context
  -> apply deterministic session projections
  -> delegate model execution planning/status helpers
  -> execute model stages with existing clients
  -> apply results through source-token guards
```

The first coordinator module should start as a thin orchestration helper around existing pure helpers rather than a replacement for all of `sessionAssembler.ts`.

## Recommended staged PRs

### PR 1: coordinator context snapshot contract

Add a small pure module, likely:

```txt
src/conversation/coordinatorRuntime.ts
src/conversation/coordinatorRuntime.test.ts
```

Initial scope:

- define `ConversationCoordinatorContext`
- define `ConversationCoordinatorStage`
- define `ConversationCoordinatorDecision`
- define `ConversationCoordinatorReasonCode`
- add helpers to summarize current session/model state without side effects
- no model calls
- no store writes
- no behavior change

This gives the coordinator a typed boundary before extraction.

### PR 2: source-token guard helper extraction

Move repeated source-token apply/discard patterns into small helpers.

Candidate helpers:

```txt
applyIfFresh(session, sourceToken, apply)
markDiscardedIfStale(session, kind, sourceToken)
```

Rules:

- must preserve current stale discard counts
- must be unit-tested against matching and mismatching tokens
- no model-call changes

### PR 3: model-stage planning extraction

Extract writer/multimodal/premium stage planning from `sessionAssembler.ts` into a pure planner that returns planned stages and skip reasons.

Rules:

- use existing `shouldRunInterpolatorWriter`, `shouldRunPremiumDeepInterpolator`, and media planning logic
- preserve existing skip reasons
- no provider calls in planner

### PR 4: media stage executor extraction

Move media analysis planning/execution to a dedicated module only after PR 3 is stable.

Rules:

- preserve partial-failure behavior
- preserve warning logging shape or replace with structured telemetry
- preserve abort behavior

### PR 5: writer stage executor extraction

Move writer translation/input/model execution after source-token helpers and model-stage planning are stable.

Rules:

- preserve user filter redaction
- preserve translation map behavior
- preserve source-token checks after translation and writer result
- wire in recovered writer routing/eval/fallback contracts only after current behavior is safely isolated

### PR 6: premium stage executor extraction

Move premium entitlement/request/execution logic after writer stage is isolated.

Rules:

- preserve entitlement checks
- preserve redaction before provider call
- preserve premium ineligible/error/ready statuses

### PR 7: coordinator runtime integration

Only after the above slices should `hydrateConversationSession` delegate to a real coordinator runtime.

The final shape should keep `sessionAssembler.ts` as the public hydration entry point while reducing it to canonical fetch/build plus coordinator delegation.

## Current helper map

Already-existing helper modules that should be composed, not duplicated:

- `src/conversation/modelExecution.ts`
  - model run diagnostics, skip/error/ready/discard helpers, model execution gates
- `src/conversation/modelSourceToken.ts`
  - source-token creation and matching
- `src/conversation/shadowSupervisor.ts`
  - shadow supervisor recommendations and telemetry
- `src/conversation/sessionPolicies.ts`
  - quality, deferred reasons, thread state, direction policies
- `src/conversation/deltaDecision.ts`
  - delta decision finalization
- `src/conversation/continuitySnapshots.ts`
  - continuity snapshots
- `src/conversation/interpretive/*`
  - interpretive confidence and explanations
- `src/runtime/*writer*`
  - recovered writer route/eval/prompt/output/fallback/finalizer/harness contracts
- `src/runtime/prompts/*`
  - recovered router/coordinator prompt contracts and JSON schemas
- `src/runtime/router*`
  - router/coordinator contract, diagnostics, execution adapter
- `src/runtime/functionGemma*`
  - FunctionGemma router invoker and local runtime

## First code PR acceptance criteria

The first runtime code PR must satisfy:

- no change to public hydration function signature
- no new provider/network calls
- no new local model loading
- no change to Cloudflare Workers AI behavior
- no broad rewrite of `sessionAssembler.ts`
- unit tests for the new pure coordinator contract/helpers
- full CI green

## Recovery index relationship

Once this plan is merged, `docs/architecture-recovery-index.md` should treat coordinator runtime extraction as started but not complete. The next implementation PR should be PR 1 above: coordinator context snapshot contract.
