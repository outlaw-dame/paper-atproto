---
title: Algorithm Layer Integration Guide
description: Current-state integration and validation guide for the shipped Phase 1 decision layer
created: 2025-01-21
status: Phase 1 integrated
---

# Algorithm Layer Integration Guide

## What This Document Is

This is no longer a “copy these snippets into the repo” guide.

Phase 1 integration is already wired into the live code paths. The job now is:

- understanding the authoritative integration points
- validating that the shipped algorithms still behave safely
- avoiding future doc drift when Phase 2+ work lands

For the canonical architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Current Integration Status

The shipped Phase 1 decision layer is integrated in production paths:

- **Contributor selection** in `src/intelligence/writerInput.ts`
- **Stance coverage** in `src/intelligence/writerInput.ts`
- **Entity centrality** in `src/intelligence/writerInput.ts`
- **Meaningful thread change** in `src/intelligence/updateInterpolatorState.ts` and `src/intelligence/threadPipeline.ts`

Supporting diversity logic is also shipped:

- **Comment redundancy suppression** in `src/intelligence/redundancy.ts`

Algorithm modules already include:

- bounded computations
- privacy-safe error logging
- graceful fallbacks where the calling path requires them
- development comparison telemetry for selection behavior

---

## Authoritative Integration Points

### 1. Writer shaping

**File:** `src/intelligence/writerInput.ts`

This is the main consumer of the decision layer.

It currently:

- selects top comments with `selectDiverseComments(...)`
- selects contributors with `selectContributorsAlgorithmic(...)`
- improves stance balance with `clusterStanceCoverage(...)` and `filterByStanceDiversity(...)`
- ranks entities with `computeEntityCentralityScores(...)`

When future work lands here, preserve these rules:

- keep the legacy fallback path intact
- log only sanitized metadata
- do not let a failed auxiliary algorithm block deterministic writer shaping

### 2. Interpolator update discipline

**File:** `src/intelligence/updateInterpolatorState.ts`

This file now owns:

- snapshot-based meaningful-change detection
- rate limiting for update churn
- bounded fallback behavior when change detection fails

When changing it:

- keep rate limiting explicit
- keep snapshot creation deterministic
- never make change detection depend on remote model availability

### 3. Verified thread pipeline

**File:** `src/intelligence/threadPipeline.ts`

This is the boundary where:

- scoring becomes `ContributionScores`
- verification is selected and retried
- thread change and confidence are finalized

When changing it:

- keep candidate selection bounded
- keep concurrency explicit
- swallow verification failures only where deterministic fallback is already available

### 4. Session orchestration

**File:** `src/conversation/sessionAssembler.ts`

This is the system-level integration point where:

- verified thread state
- translation
- multimodal gating
- default writer
- premium writer

are connected into one execution flow.

When changing it:

- preserve source-token guarding so stale async work cannot overwrite new state
- keep all model lanes optional enrichments over a deterministic base
- do not bypass sanitization or user-rule redaction layers

---

## Validation Checklist

Use this list after any change to the decision layer.

### Decision-layer correctness

- contributor selection still returns non-empty results for healthy threads
- stance balancing does not drop the dominant contributor set entirely
- entity ranking prefers central entities over incidental mentions
- change detection suppresses noise without hiding genuine shifts
- comment diversity does not collapse the writer input to a single comment

### Safety and privacy

- no algorithm logs raw post text or unsanitized errors
- fallback paths still work when algorithm code throws
- remote model calls still receive bounded, validated inputs only
- production-only telemetry/admin behavior stays secret-gated

### Architectural cohesion

- the deterministic thread state is still useful before any remote model call
- multimodal remains explicitly gated
- premium output still enriches, not replaces, the default interpretation path
- search/discovery docs do not claim story-clustering behavior that does not exist

---

## Suggested Validation Commands

These are the highest-signal checks for the current integration.

```bash
./node_modules/.bin/vitest run \
  src/intelligence/writerInput.test.ts \
  src/intelligence/algorithms/resilience.test.ts \
  src/intelligence/algorithms/loggingSafety.test.ts \
  src/conversation/sessionAssemblerRedaction.test.ts \
  src/conversation/modelExecution.test.ts \
  server/src/routes/aiSessions.telemetryAccess.test.ts \
  src/server/aiSessionsRoute.integration.test.ts
```

If you are changing runtime policy or browser-runtime messaging, also run:

```bash
./node_modules/.bin/vitest run \
  src/runtime/modelPolicy.test.ts
```

If type coverage is important for the change, also run:

```bash
./node_modules/.bin/tsc --noEmit
```

---

## What Not To Do

Do not reintroduce these old patterns:

- threshold-only contributor naming
- flat mention-count entity ranking
- timer-only interpolator refreshes
- browser UI that implies production telemetry access without admin authorization
- docs that describe planned modules as if they are already live

---

## Phase 2+ Rule

Any future algorithm doc should answer these questions explicitly:

1. Is it shipped, partially shipped, or planned?
2. Which exact file consumes it today?
3. What is the deterministic fallback if it fails?
4. Does it change privacy, safety, or origin-boundary assumptions?

If a doc cannot answer those four questions, it is still a plan, not an integration guide.
