# Algorithm Layer Status

**Status:** current-state document  
**Date:** April 2, 2026  
**Scope:** what is already shipped, what still feels disconnected, and what remains to build

---

## Executive Summary

The repo no longer lacks an algorithmic layer outright.

What it has now:

- shipped contributor-selection logic
- shipped thread-change detection
- shipped entity-centrality ranking
- shipped stance-coverage clustering
- shipped comment-level redundancy suppression

What still creates the “close but disconnected” feeling:

- there is no user-visible explanation layer for why the system chose a given summary or contributor
- discovery/search is not yet powered by full story clustering
- composer context is still richer than before, but not yet packed by a dedicated context-summarization selector
- local browser multimodal remains staged while remote multimodal is authoritative

The practical gap is now **cohesion, explanation, and discovery depth**, not the total absence of deterministic decision-making.

---

## Where The Decision Layer Lives

| Layer | Files | Current role |
|---|---|---|
| Deterministic substrate | `src/lib/resolver/atproto.ts`, `src/intelligence/context/*`, `src/intelligence/heuristics/*` | Stable parsing, shaping, heuristics |
| Decision algorithms | `src/intelligence/algorithms/*` | Contributor, change, entity, stance decisions |
| Supporting diversity logic | `src/intelligence/redundancy.ts` | Comment-level redundancy suppression |
| Verification and confidence | `src/intelligence/threadPipeline.ts`, `src/intelligence/verification/*`, `src/intelligence/confidence.ts` | Evidence and confidence shaping |
| Writer shaping | `src/intelligence/writerInput.ts` | Turns thread state into bounded writer inputs |
| Session orchestration | `src/conversation/sessionAssembler.ts` | Connects deterministic, algorithmic, evidence, and model lanes |

---

## Shipped Algorithms

### 1. Contributor Inclusion Selection

**Implementation:** `src/intelligence/algorithms/contributorSelection.ts`  
**Integrated in:** `src/intelligence/writerInput.ts`

What it does now:

- scores contributors with multi-factor selection instead of a simple threshold gate
- preserves fallback behavior
- exposes comparison telemetry in development

### 2. Meaningful Thread-Change Detection

**Implementation:** `src/intelligence/algorithms/changeDetection.ts`  
**Integrated in:** `src/intelligence/updateInterpolatorState.ts`, `src/intelligence/threadPipeline.ts`

What it does now:

- computes bounded change magnitude and reasons
- rate-limits updates
- feeds thread-change outputs back into the interpretation pipeline

### 3. Entity Centrality

**Implementation:** `src/intelligence/algorithms/entityCentrality.ts`  
**Integrated in:** `src/intelligence/writerInput.ts`

What it does now:

- ranks entities by centrality instead of flat mention count
- blends root presence, contributor mentions, and canonical confidence

### 4. Stance Coverage Clustering

**Implementation:** `src/intelligence/algorithms/stanceClustering.ts`  
**Integrated in:** `src/intelligence/writerInput.ts`

What it does now:

- groups contributors by inferred stance
- helps preserve coverage balance
- produces suppression and recommendation data

### 5. Baseline Redundancy Suppression

**Implementation:** `src/intelligence/redundancy.ts`  
**Integrated in:** `src/intelligence/writerInput.ts`

Important nuance:

- this is already shipped
- it is **not** the future full “redundancy network” from the roadmap
- today it operates at comment-selection time, not as a network-wide explanation layer

---

## What Is Still Missing

These are the real architectural gaps that remain.

### Discovery query understanding

Still missing:

- a deterministic classifier for search/discovery intent such as person, topic, source, story, or visual/media-heavy lookup
- a selector that can change fusion weights and discovery surfaces based on that intent

Impact:

- discovery already has strong retrieval primitives
- it still behaves more like a powerful search box than a fully Neeva-style discovery orchestrator

### Explanation generation

Still missing:

- machine-readable “why this contributor” explanations
- user-visible “why this summary” reasoning

Impact:

- the system makes better decisions than it used to, but still does not explain them well

### Discovery-native story clustering

Still missing:

- a first-class story clustering algorithm for Explore/discovery
- deeper alignment between entity centrality, stance structure, and surfaced story groups

Impact:

- thread interpretation feels coherent
- discovery still feels less graph-native than the thread pipeline

### Context summarization selector

Still missing:

- a dedicated selector that compresses composer context into the smallest high-value snapshot

Impact:

- composer guidance has better structure than before
- context packing is still not an explicit algorithmic stage

### Translation selection algorithm

Still missing:

- a deterministic selector for which posts are worth translating first

Impact:

- translation exists and is integrated
- the selection policy remains more operational than algorithmic

### Multimodal escalation for search/runtime

Still missing:

- a dedicated visual-search escalation algorithm
- production-ready local browser multimodal runtime

Impact:

- remote multimodal analysis is integrated for thread interpretation
- search-time multimodal specialization remains future work

---

## Current Architectural Reading

The best description of the live decision pipeline is:

1. deterministic substrate shapes the thread
2. algorithmic layer decides what matters
3. verification and confidence decide what can be trusted
4. remote writers summarize an already-structured state
5. premium and multimodal lanes enrich, but do not replace, the core decision path

The correct Neeva-style extension of that pipeline is:

- query understanding improves retrieval and grouping before any answer-like presentation
- explanation metadata makes ranking and grouping legible to the user
- story clustering organizes discovery around developments, not just matching posts
- generative text stays bounded to packaging already-selected evidence

It should not become:

- an opaque answer engine replacing deterministic ranking and verification
- a heavy reranker inserted into every search by default
- a discovery UI that implies hidden story clustering before that algorithm actually ships

That is why the remaining work should prioritize **explanation and discovery**, not another round of disconnected model features.

---

## Next Build Order

Recommended next sequence:

1. **Explanation generation**
   This closes the trust/cohesion gap fastest.

2. **Discovery query understanding**
   This is the nearest clean application of the Neeva research because it improves how retrieval is routed without weakening the local-first architecture.

3. **Story clustering for Explore**
   This brings discovery up to the quality of the thread pipeline.

4. **Context summarization selector**
   This tightens composer quality without adding more model complexity.

5. **Translation selection**
   This optimizes multilingual coverage after the core story logic is stronger.

6. **Multimodal escalation**
   This should wait until visual-search telemetry justifies it.

---

## Guardrails

All future algorithm work should keep the current safety contract:

- validate every input shape before scoring
- keep all computations bounded and deterministic
- avoid raw content logging in algorithm errors
- preserve graceful fallback paths
- keep retries and backoff at the transport boundary, not hidden inside scoring logic
- treat browser multimodal as staged until local safety and runtime guarantees are real
