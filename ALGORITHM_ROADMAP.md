---
title: Glympse Algorithm Roadmap
description: Current-state roadmap for shipped and planned decision algorithms
created: 2025-01-21
status: Phase 1 shipped; later phases planned
---

# Glympse Algorithm Roadmap

## Executive Summary

The repo has already crossed the line from “models interpret, humans decide” to “models interpret, algorithms help decide.”

What is true today:

- Phase 1 core decision algorithms are shipped in live code paths.
- A baseline redundancy suppressor is also shipped for comment selection.
- The biggest remaining gaps are explanation, discovery clustering, and context packing.

What is **not** true today:

- Explore is not yet fully driven by a story-clustering algorithm.
- Explanation-generation is not yet a user-visible reasoning layer.
- Local browser multimodal is not yet production-ready.

---

## Phase 1 — Shipped Foundation

| # | Capability | Status | Primary files | Notes |
|---|---|---|---|---|
| 1 | Contributor inclusion selection | Shipped | `src/intelligence/algorithms/contributorSelection.ts`, `src/intelligence/writerInput.ts` | Preferred path with legacy fallback |
| 2 | Thread-change detection | Shipped | `src/intelligence/algorithms/changeDetection.ts`, `src/intelligence/updateInterpolatorState.ts`, `src/intelligence/threadPipeline.ts` | Drives meaningful updates and change reasons |
| 3 | Entity centrality | Shipped | `src/intelligence/algorithms/entityCentrality.ts`, `src/intelligence/writerInput.ts` | Replaces flat mention-count ranking in writer shaping |
| 4 | Stance coverage clustering | Shipped | `src/intelligence/algorithms/stanceClustering.ts`, `src/intelligence/writerInput.ts` | Improves coverage balance and suppression |
| 5 | Comment diversity suppression | Shipped baseline | `src/intelligence/redundancy.ts`, `src/intelligence/writerInput.ts` | Useful today, but narrower than the planned full redundancy network |

### Outcome

Thread interpretation now has a real decision layer before remote writer calls.

---

## Phase 2 — Cohesion And Context

These should be the next algorithms because they improve the “one flowing system” feel fastest.

### 6. Explanation Generation

**Status:** planned  
**Purpose:** make the decision layer legible to users and developers

Needed outputs:

- why a contributor was included
- why a summary changed
- why a stance was suppressed

Recommended placement:

- `src/intelligence/algorithms/explanationGeneration.ts`
- consumed by conversation/session projection and premium/default summary UI

### 7. Context Summarization Selector

**Status:** planned  
**Purpose:** choose the smallest high-value set of posts for composer and summary context

Recommended placement:

- `src/intelligence/algorithms/contextSummarization.ts`
- consumed before or inside writer/composer context shaping

### 8. Full Redundancy Network

**Status:** planned, baseline exists  
**Purpose:** move from comment-level diversity suppression to cross-contributor, cross-claim redundancy reasoning

Recommended placement:

- `src/intelligence/algorithms/redundancyNetwork.ts`

Why it still matters even though `src/intelligence/redundancy.ts` exists:

- current suppression is local to comment selection
- future work should explain redundancy across claims, contributors, and summary content

---

## Phase 3 — Discovery

### 9. Story Clustering For Explore

**Status:** planned  
**Purpose:** make discovery surfaces feel as coherent as the thread pipeline

Recommended placement:

- `src/intelligence/algorithms/storyClustering.ts`
- consumed by Explore/discovery projection code

### 10. Translation Selection

**Status:** planned  
**Purpose:** choose what to translate first using deterministic value, not operational convenience

Recommended placement:

- `src/intelligence/algorithms/translationSelection.ts`

---

## Phase 4 — Specialization

### 11. Multimodal Escalation

**Status:** planned  
**Purpose:** decide when visual-search or heavier multimodal investment is worth it

Recommended placement:

- `src/intelligence/algorithms/multimodalEscalation.ts`

This should wait until:

- discovery telemetry shows enough visual demand
- local browser multimodal support is truly safe
- search/discovery clustering is stronger

---

## Recommended Build Order

1. Explanation generation
2. Context summarization selector
3. Full redundancy network
4. Story clustering for Explore
5. Translation selection
6. Multimodal escalation

This order keeps the thread pipeline coherent first, then upgrades discovery, then specializes.

---

## Guardrails

Every future algorithm should keep the existing production standards:

- bounded inputs and outputs
- privacy-safe logs
- deterministic fallback path
- explicit transport-level retries and backoff
- no direct browser exposure of privileged telemetry or model-provider secrets

---

## Canonical Reality Check

If this roadmap ever disagrees with the code:

1. trust `src/conversation/sessionAssembler.ts`
2. trust `src/intelligence/threadPipeline.ts`
3. trust `src/intelligence/writerInput.ts`
4. update this roadmap

The roadmap is a planning aid, not the source of truth.
