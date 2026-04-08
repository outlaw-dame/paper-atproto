---
title: Algorithm Validation Quick Start
description: Fast checks for the shipped decision layer
created: 2025-01-21
status: Current
---

# Algorithm Validation Quick Start

## Use This For

Use this document when you need to quickly verify that the current algorithm layer still behaves as one coherent system.

Do **not** use this document as a copy-paste integration guide. The Phase 1 algorithms are already integrated.

---

## 1. Confirm The Real Integration Points

Read these files in order:

1. `src/conversation/sessionAssembler.ts`
2. `src/intelligence/threadPipeline.ts`
3. `src/intelligence/writerInput.ts`
4. `src/intelligence/updateInterpolatorState.ts`
5. `src/intelligence/algorithms/index.ts`

What you should see:

- the session assembler orchestrates the full interpretation flow
- the verified thread pipeline computes verification, confidence, and change
- writer input consumes contributor, stance, entity, and comment-diversity logic
- change detection is snapshot-based once a refresh happens, while Story mode freshness is still driven by bounded polling rather than live push

---

## 2. Run The Highest-Signal Tests

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

These cover:

- algorithm output resilience
- privacy-safe logging
- writer-shaping correctness
- session/model orchestration integrity
- production telemetry access controls

---

## 3. Spot-Check The Architecture Contract

### Writer shaping

In `src/intelligence/writerInput.ts`, confirm that:

- `selectDiverseComments(...)` is still applied before building the writer payload
- `selectContributorsAlgorithmic(...)` is still the preferred path
- stance balancing still layers on top instead of replacing contributor selection
- entity centrality still ranks entities before the final writer shape is built

### Change detection

In `src/intelligence/updateInterpolatorState.ts`, confirm that:

- snapshot comparison still gates updates
- rate limiting still prevents churn
- fallback behavior still exists when change logic fails

### Session orchestration

In `src/conversation/sessionAssembler.ts`, confirm that:

- verification runs before writer shaping
- translation and multimodal remain bounded enrichments
- premium interpolation stays entitlement-gated
- source-token checks still prevent stale writes

---

## 4. Security And Privacy Smoke Check

Read these files together:

- `server/src/routes/aiSessions.ts`
- `src/components/LocalAiRuntimeSection.tsx`
- `server/src/routes/llm.ts`

What should be true:

- production AI-session telemetry requires `AI_SESSION_TELEMETRY_ADMIN_SECRET`
- the browser UI does not pretend telemetry is available in production without that secret
- browser clients still do not call Ollama or Gemini directly
- server routes still validate, sanitize, and protect model traffic

---

## 5. Know What Is Still Planned

These are still future work and should not be described as shipped:

- `storyClustering`
- `contextSummarization`
- `explanationGeneration`
- `translationSelection`
- `multimodalEscalation`
- full network-level redundancy suppression
- production-ready local browser multimodal runtime

If you see docs or UI copy treating those as already live, that is drift.

---

## 6. Optional Full Validation

If your change touched shared types, runtime policy, or route contracts, also run:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run src/runtime/modelPolicy.test.ts
```

---

## Success Criteria

You are in a good state when all of the following are true:

- docs describe the current code, not the old plan
- the deterministic pipeline still stands on its own without remote models
- the decision layer still shapes the writer inputs
- premium and multimodal remain bounded enrichments
- production telemetry and admin surfaces remain secret-gated
