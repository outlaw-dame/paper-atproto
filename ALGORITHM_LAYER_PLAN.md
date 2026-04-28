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

- explanation exists in parts, but not yet as a complete user-visible reasoning layer for summary, contributor, and cluster selection
- discovery/search is intent-aware now, but not yet powered by full story clustering
- composer context is still richer than before, but not yet packed by a dedicated context-summarization selector
- local browser multimodal remains staged while remote multimodal is authoritative
- discovery still needs to preserve glanceable utility so it does not repeat Neeva Gist's over-orchestrated failure mode

The practical gap is now **cohesion, explanation depth, story grouping, and utility-preserving presentation**, not the total absence of deterministic decision-making.

---

## Neeva Gist Reading

Neeva Gist matters here because it validated a product instinct we share: mobile discovery can be more effective when results are packaged as compact narrative units instead of flat lists. It also represented a strategic mobile pivot around an early generative-AI UX problem: too much output was either a wall of text or a bespoke image, with very little high-quality narrative packaging in between. Its strongest contribution was a story-card metaphor that made search feel navigable and visually legible.

More specifically, the parts worth retaining are:

1. an Instagram-like visual card language for mobile browsing
2. concise AI synopses instead of long-form answer blobs
3. multimedia integration when visuals materially help understanding
4. tap-based drift between related ideas rather than hard query resets
5. snackable consumption that still preserves evidence and source access
6. a privacy-first product stance rather than ad-optimized ranking

Its main failure mode was equally important: the experience became too directive for quick, utilitarian lookups. The immersive flow created novelty, but it also added friction when a user only needed a fast answer or source check.

For this repo, the correct lesson is:

1. keep the **story packaging**
2. keep the **source visibility**
3. keep the **media-aware presentation**
4. reject the **mandatory immersive flow**
5. reject any architecture where generative packaging outruns deterministic selection

That is why the right adaptation is not “copy Gist.” It is “use Gist to sharpen an ATProto-native discovery system that is faster, more legible, and more truthful about evidence.”

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

### Discovery story clustering

Still missing:

- a first-class story clustering algorithm for search/discovery results
- event/development grouping that turns result sets into coherent developments instead of ranked isolated posts
- a cluster selector that can balance topic centrality, source density, participant diversity, and freshness

Impact:

- discovery now has deterministic intent routing and surface adaptation
- it still behaves more like a strong search box with better packaging than a full story-native discovery orchestrator

### Explanation generation

Partially shipped:

- intent labels in search/discovery
- source/domain evidence reasons
- explanation chips on surfaced stories

Still missing:

- machine-readable “why this contributor” explanations across thread interpretation
- user-visible “why this summary” reasoning across the canonical conversation layer
- explanation of why a group of posts forms one story cluster instead of another

Impact:

- the system is more legible than before, but still stops short of a full trust/explanation layer

### Discovery utility balance

Still missing:

- a formal policy for when discovery should stay glanceable versus when it should expand into deeper story packaging
- stronger repetition controls so adjacent cards or summaries do not restate the same fact pattern
- explicit separation between quick lookup surfaces and deeper exploratory surfaces

Impact:

- this is the main product guardrail that keeps the system from inheriting Gist's biggest usability weakness

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
- fast-path discovery stays available for users who want a quick source or post lookup rather than a guided story flow

It should not become:

- an opaque answer engine replacing deterministic ranking and verification
- a heavy reranker inserted into every search by default
- a discovery UI that implies hidden story clustering before that algorithm actually ships

That is why the remaining work should prioritize **explanation and discovery**, not another round of disconnected model features.

---

## Next Build Order

Recommended next sequence:

1. **Story clustering for Explore**
   This is now the clearest missing Neeva-aligned layer.

2. **Deeper explanation generation**
   This closes the trust/cohesion gap and prevents story packaging from feeling opaque.

3. **Discovery utility-balance policy**
   This prevents over-orchestrated flows and keeps quick lookups fast.

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
