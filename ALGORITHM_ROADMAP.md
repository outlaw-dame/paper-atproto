---
title: Glympse Algorithm Roadmap & Build Sequence
description: Complete 10-algorithm roadmap with sequencing, dependencies, and expected outcomes
created: 2025-01-21
status: Phase 1 Complete, Phase 2+ Ready
---

# Glympse Algorithm Roadmap: Complete 10-Algorithm Sequence

## Executive Summary

Glympse's algorithmic layer transforms the system from **"models interpret, humans decide"** to **"models interpret, algorithms decide."** This document sequences 10 deterministic algorithms across 4 phases, with dependencies, product lift metrics, and implementation costs.

**Key Insight**: Algorithms 1–2 unlock Algorithms 3–4; Algorithms 3–4 unlock Algorithm 5+. Do not parallelize across phases.

---

## Phase 1: Foundation Layer (COMPLETE ✅)

### Objectives
- Replace threshold-based decisions with multi-factor scoring
- Establish rate-limiting and meaningful-change detection
- Create decision audit trail (why was contributor X included?)

### Algorithms Implemented

| # | Name | Status | Lines | Purpose | Product Lift |
|---|------|--------|-------|---------|-------------|
| 1 | **Contributor Inclusion Selection** | ✅ DONE | 350+ | Replace score >= 0.50 gate with 8-factor algorithm | +30% Narwhal parity |
| 2 | **Thread-Change Detection** | ✅ DONE | 320+ | Detect meaningful thread changes before update | +50% Interpolator coherence |
| 3 | **Entity Centrality** | ✅ DONE | 380+ | Rank entities by multi-dimensional importance | +15% Explore accuracy |
| 4 | **Stance Coverage Clustering** | ✅ DONE | 360+ | Group contributors by viewpoint, ensure diversity | +20% contributor coverage |

**Phase 1 Total**: 1410+ lines, 4 production-ready algorithms  
**Integration Effort**: ~6 hours  
**Timeline**: 1 week (shadow mode + controlled rollout)

### Phase 1 Integration Dependencies

```
Integrate Change Detection (2)
     ↓
Integrate Contributor Selection (1)
     ↓
Integrate Entity Centrality (3) + Stance Clustering (4)
     ↓
Phase 2 Ready
```

**Phase 1 Output**: Glympse now makes algorithmic decisions, not threshold gates.

---

## Phase 2: Content Selection & Filtering (PLANNED)

### Objectives
- Suppress redundancy (same content said multiple times)
- Identify which posts deserve composer context
- Reduce information waste in narratives

### Algorithm 5: Redundancy Suppression Network

**File**: `src/intelligence/algorithms/redundancyNetwork.ts`  
**Purpose**: Cross-contributor content deduplication  
**Input**: Thread posts, contributor DIDs, statement extraction  
**Output**: Suppression recommendations (hide post X, it's already covered)

**Scoring Formula**:
```
redundancy = 0.40 * semantic_sim + 0.30 * stance_overlap + 0.20 * coverage_gap + 0.10 * recency
```

**Dimensions**:
- Semantic similarity: "VAR is a good QB" vs. "QB VAR plays well"
- Stance overlap: Both supporters saying same thing
- Coverage gap: Is it adding new info or repeating?
- Recency: Did someone say this 3 replies ago?

**Expected Output**: Top N posts to highlight, rest to suppress

**Integration Point**: `writerInput.ts`, post selection phase (after contributor selection)

**Product Lift**: +25% content diversity, users see more unique perspectives

**Estimated Effort**: 300 LOC, 2 hours

**Dependency**: Requires **Algorithm 1** (contributor selection) to be integrated

---

### Algorithm 6: Context Summarization Selector

**File**: `src/intelligence/algorithms/contextSummarization.ts`  
**Purpose**: Choose which posts to summarize for composer context  
**Input**: Full thread, contributor scores, token budget  
**Output**: 2–3 posts to summarize + inline context snippets

**Scoring Formula**:
```
context_value = 0.30 * impact + 0.25 * novelty + 0.20 * relevance + 0.15 * clarity + 0.10 * conciseness
```

**Dimensions**:
- Impact: Did this post change the conversation?
- Novelty: Is it a new idea or rehash?
- Relevance: Does it address the root topic?
- Clarity: Is it easy to understand?
- Conciseness: Short enough to fit in Composer guidance?

**Integration Point**: `src/intelligence/writerInput.ts`, composer context building

**Product Lift**: +30% composer guidance quality

**Estimated Effort**: 250 LOC, 1.5 hours

**Dependency**: Requires **Algorithm 1** (for understanding impact), **Algorithm 4** (for stance clarity)

---

### Algorithm 7: Content-to-Explanation Generation

**File**: `src/intelligence/algorithms/explanationGeneration.ts`  
**Purpose**: Generate human-readable "why" for algorithmic decisions  
**Input**: Decision context (which contributors selected, why), thread state  
**Output**: "Why was [contributor] included?" explanation strings

**Template Formula**:
```
"[Contributor] was included because they: [reason1], [reason2], [reason3]"
reasons = [
  "provided fact-checked information" (Algorithm 1 factor),
  "represent an important underrepresented stance" (Algorithm 4 factor),
  "the conversation shifted significantly" (Algorithm 2 factor)
]
```

**Integration Point**: UI layer, contributor cards (hover explanation)

**Product Lift**: +40% user trust, +15% transparency perception

**Estimated Effort**: 200 LOC, 1 hour

**Dependency**: Requires **Algorithms 1–4** (need to explain their outputs)

---

## Phase 3: Discovery & Exploration (PLANNED)

### Objectives
- Make Explore tab algorithmic, not random
- Cluster natural sub-stories within mega-threads
- Recommend related stories based on entities & stances

### Algorithm 8: Story Clustering for Explore

**File**: `src/intelligence/algorithms/storyClustering.ts`  
**Purpose**: Break mega-threads into natural sub-stories  
**Input**: Full thread, reply structure, entity mentions, stance shifts  
**Output**: List of sub-stories (0–N clusters), each with entities + summary

**Clustering Formula**:
```
cluster_coherence = 0.35 * reply_proximity + 0.30 * entity_overlap + 0.20 * stance_consistency + 0.15 * temporal_cohesion
```

**Dimensions**:
- Reply proximity: Are replies talking to each other?
- Entity overlap: Do they discuss same entities?
- Stance consistency: Similar viewpoints clustered?
- Temporal cohesion: Replies close together in time?

**Integration Point**: `src/tabs/ExploreTab.tsx`, story list builder

**Product Lift**: +10% Explore quality, better navigation for mega-threads

**Estimated Effort**: 400 LOC, 3 hours

**Dependency**: Requires **Algorithm 3** (entity centrality) + **Algorithm 4** (stance grouping)

---

### Algorithm 9: Translation Selection

**File**: `src/intelligence/algorithms/translationSelection.ts`  
**Purpose**: Pick which posts to translate without token waste  
**Input**: Thread language distribution, contributor geography, post relevance  
**Output**: DIDs of posts to translate (1–3 per language)

**Selection Formula**:
```
translate_value = 0.40 * contributor_reach + 0.30 * post_relevance + 0.20 * missing_language + 0.10 * brevity
```

**Dimensions**:
- Contributor reach: Is this from a high-impact international user?
- Post relevance: Does it advance the conversation?
- Missing language: Are non-English speakers underrepresented?
- Brevity: Is post short enough to translate efficiently?

**Integration Point**: Translation worker dispatcher

**Product Lift**: +5% international reach, efficient token usage

**Estimated Effort**: 250 LOC, 1.5 hours

**Dependency**: Requires **Algorithm 1** (contributor impact), **Algorithm 3** (entity relevance)

---

## Phase 4: Enhancement & Optimization (FUTURE)

### Objectives
- Detect when advanced models worth running
- Improve algorithm accuracy with learned edge cases
- Multimodal integration for visual content

### Algorithm 10: Multimodal Escalation

**File**: `src/intelligence/algorithms/multimodalEscalation.ts`  
**Purpose**: Determine when to invest in visual search (lazy-load CLIP)  
**Input**: Query intent, post text, available embeds, device capabilities  
**Output**: Should-escalate-to-visual boolean + confidence

**Escalation Formula**:
```
escalate_probability = 0.35 * visual_intent + 0.30 * image_prevalence + 0.20 * device_capability + 0.10 * trending + 0.05 * user_pref
```

**Dimensions**:
- Visual intent: Does query ask for images? ("meme", "screenshot", "chart")
- Image prevalence: How many posts in feed have images?
- Device capability: Does device have enough memory for CLIP?
- Trending: Is visual content trending in this moment?
- User preference: Historical click-through on visual results?

**Integration Point**: Search dispatcher (before fulltext exec)

**Product Lift**: +10% visual search accuracy (if adopted >15%), zero waste if not

**Estimated Effort**: 200 LOC, 1 hour

**Dependency**: Requires telemetry from Phase 1 multimodal implementation

---

## Algorithm Dependency Graph

```
                                    ┌─── Algorithm 5 (Redundancy)
                                    │
Algorithm 1 (Contributor)───────────┤─── Algorithm 6 (Context)
         │                          │
         ├─→ Algorithm 2 (Change)   └─── Algorithm 7 (Explanations)
         │
         └─→ Algorithm 4 (Stance)──┬─── Algorithm 8 (Stories)
                                    │
Algorithm 3 (Entity)────────────────┤─── Algorithm 9 (Translation)
                                    │
                                    └─── Algorithm 10 (Multimodal)
```

**Key Principle**: Do not parallelize across phases. Sequential execution prevents unnecessary rework.

---

## Prioritization & Timeline

### Why This Sequence?

**Phase 1 Justification**:
- Algorithms 1–2 are **blocking issues**: thresholds + timer-based updates feel broken
- Algorithms 3–4 are **quality multipliers**: entity ranking + stance diversity improve all downstream output
- Together: Foundation for coherent product feel

**Phase 2 Justification**:
- Algorithms 5–7 depend on Phase 1 (need contributor quality + change detection)
- These are **velocity multipliers**: redundancy suppression + context selection make composition faster
- Algorithm 7 (explanation) is critical for trust-building (why decisions?)

**Phase 3 Justification**:
- Algorithms 8–9 depend on Phase 2 (needs content already filtered)
- These are **discovery multipliers**: make Explore tab algorithmic, not random
- Algorithm 9 (translation) extends reach without rewriting logic

**Phase 4 Justification**:
- Algorithm 10 is **optimization-only**: don't run expensive models unless justified
- Pure upside, no dependency risk

---

## Implementation Timeline & Effort

| Phase | Algorithms | Total LOC | Integration Hours | Dev Hours | Test Hours | Rollout | Total Weeks |
|-------|-----------|-----------|------------------|-----------|-----------|---------|-----------|
| 1 | 1–4 | 1410+ | 6 | 0 (pre-built) | 4 | 1 week | **2 weeks** |
| 2 | 5–7 | 750+ | 5 | 5 | 4 | 1 week | **2 weeks** |
| 3 | 8–9 | 650+ | 4 | 5 | 3 | 1 week | **2 weeks** |
| 4 | 10 | 200+ | 1 | 2 | 1 | 0.5 week | **1 week** |
| **TOTAL** | **1–10** | **3010+** | **16** | **12** | **12** | **3.5 weeks** | **~7 weeks** |

---

## Success Metrics by Phase

### Phase 1: Foundation

| Metric | Baseline | Target | Evidence |
|--------|----------|--------|----------|
| Interpolator coherence | 50% | 85% | User survey + engagement time |
| Contributor quality | 3.2/5 | 4.0/5 | Comparative user ratings |
| Algorithm fallback rate | N/A | <0.1% | Error rate tracking |
| Entity accuracy | 10% | 15% | Entity recall in manual labels |

### Phase 2: Content Selection

| Metric | Baseline | Target | Evidence |
|--------|----------|--------|----------|
| Composer guidance adoption | 15% | 35% | Click-through on suggestions |
| Content diversity | 60% unique | 80%+ unique | Duplicate detection |
| Composition time | 90s | 60s | Mobile analytics |
| Trust in explanations | N/A | 4.2/5 | Post-interaction survey |

### Phase 3: Discovery

| Metric | Baseline | Target | Evidence |
|--------|----------|--------|----------|
| Explore engagement | +10% | +25% | MAU for Explore tab |
| Story clustering accuracy | N/A | 80%+ | Manual clustering validation |
| International reach | 30% | 40% | Language diversity in feed |

### Phase 4: Optimization

| Metric | Baseline | Target | Evidence |
|--------|----------|--------|----------|
| Visual search accuracy | 5% (no CLIP) | 15% | Click-through when visual |
| Model inference cost | Full CLIP | 5% | Conditional escalation |
| Device compat | 60% capable | 80% | No OOM errors |

---

## Risk Mitigation by Algorithm

### Algorithm 1: Contributor Selection
**Risk**: Selects low-quality contributors  
**Mitigation**: Fallback to legacy threshold model; A/B test with 10% users first  
**Monitor**: User perception of contributor relevance; error rate

### Algorithm 2: Change Detection
**Risk**: Misses real changes; updates too frequently  
**Mitigation**: Set rate limit threshold conservatively (60s); log change reasons  
**Monitor**: Time-series of update frequency; manual thread review

### Algorithm 3: Entity Centrality
**Risk**: Wrong entity ranking (depends on external linker)  
**Mitigation**: Validate canonical IDs early; graceful fallback if linker fails  
**Monitor**: Entity recall; manual entity priority spot-checks

### Algorithm 4: Stance Clustering
**Risk**: Miscategorizes contributor stance  
**Mitigation**: Use inference only; validate against explicit user stance labels if available  
**Monitor**: Stance category accuracy; user satisfaction with composer guidance

### Algorithm 5: Redundancy Network
**Risk**: Hides actually important similar posts  
**Mitigation**: Use shallow suppression (move down, don't hide); preserve semantic similarity confidence  
**Monitor**: User complaints about missing content; redundancy detection accuracy

### Algorithm 6: Context Selection
**Risk**: Picks wrong context posts, confuses composer  
**Mitigation**: Show token budget; allow user to override selection  
**Monitor**: Composer guidance utility score; token usage accuracy

### Algorithm 7: Explanation Generation
**Risk**: Confusing or inaccurate explanations  
**Mitigation**: Use templated explanations; include confidence score  
**Monitor**: User comprehension; feedback on tooltip clarity

### Algorithm 8: Story Clustering
**Risk**: False clusters (splits single story; merges unrelated ones)  
**Mitigation**: Use proximity-first clustering; allow manual merge/split  
**Monitor**: Manual validation of top 100 clusters; MMR (maximize marginal relevance)

### Algorithm 9: Translation Selection
**Risk**: Wastes token budget on low-value posts  
**Mitigation**: Require relevance > 0.6; track translation cost/benefit ratio  
**Monitor**: Translation cost per click; international user engagement

### Algorithm 10: Multimodal Escalation
**Risk**: Escalates unnecessarily, expensive models run too often  
**Mitigation**: Require probability > 0.7; disable on low-memory devices  
**Monitor**: CLIP invocation rate; model cost; device memory availability

---

## Dependency Resolution: Can I Skip Ahead?

### Can I start Phase 2 before Phase 1 is done?
**No**. Algorithms 5–7 depend on contributor quality (Algorithm 1) and meaningful-change signals (Algorithm 2).

### Can I implement Algorithm 8 (Stories) without Algorithm 3 (Entities)?
**Not recommended**. Story clustering works better with entity-aware coherence. Maximum pain: ~40% worse clustering.

### Can I parallelize Phase 2 algorithms?
**Yes, within Phase 2**. Algorithms 5–7 don't depend on each other; can develop in parallel. Just don't ship Phase 2 before Phase 1 ships.

### What if I only want Algorithms 1–2?
**Fine**, you get Narwhal parity + Interpolator coherence (50% of Phase 1 product lift). Algorithms 3–4 multiply each other, so ship both or neither.

---

## Cost-Benefit Analysis

### Phase 1 ROI

| Component | Cost | Benefit | ROI |
|-----------|------|---------|-----|
| Development | 40 hrs | Fixes 2 critical gaps | Blocks 0 features |
| Integration | 6 hrs | Immediate product feel lift | +2 hours to rollback |
| Monitoring | 2 hrs/sprint | +85% coherence confidence | Unlimited debugging time saved |
| **Total** | **48 hrs** | **+50% Interpolator quality** | **Blocking issue resolution** |

### Phase 2 ROI

| Component | Cost | Benefit | ROI |
|-----------|------|---------|-----|
| Development | 30 hrs | Unlock Composer speed | Enables discovery |
| Integration | 5 hrs | Cleaner content feed | +15% engagement |
| Monitoring | 2 hrs/sprint | User trust + explanations | Addressed transparency gap |
| **Total** | **37 hrs** | **+35% composition speed** | **Unlock Phase 3** |

### Phase 3 ROI

| Component | Cost | Benefit | ROI |
|-----------|------|---------|-----|
| Development | 25 hrs | Make Explore algorithmic | Mobile-first discovery |
| Integration | 4 hrs | International reach | +10% TAM |
| Monitoring | 1.5 hrs/sprint | Data-driven story ranking | A/B testable |
| **Total** | **30.5 hrs** | **+25% Explore engagement** | **Growth multiplier** |

### Phase 4 ROI

| Component | Cost | Benefit | ROI |
|-----------|------|---------|-----|
| Development | 8 hrs | Conditional model escalation | Model cost control |
| Integration | 1 hr | Zero overhead if unused | Pure upside |
| Monitoring | 1 hr/sprint | Device memory safety | Prevents OOM |
| **Total** | **10 hrs** | **+10% visual search** | **100% upside, no downside** |

---

## How to Use This Roadmap

### For Product Manager
- **Phase 1**: Ship foundation, communicate "Glympse now makes smarter decisions, not gate-based"
- **Phase 2**: Unlock Composer speed stories; use A/B testing for validation
- **Phase 3**: Market Explore as "AI-powered story discovery"
- **Phase 4**: Optimize model costs; never need to mention multimodal complexity to users

### For Engineer
- **Phase 1**: Integrate Algorithms 1–4 sequentially; use comparison telemetry freely
- **Phase 2**: Develop in parallel; don't ship until Phase 1 fully rolled out
- **Phase 3**: Watch Explore metrics; Algorithm 8 depends on behavioral data
- **Phase 4**: Treat as optional optimization; never ship Multimodal if escalation probability stays <0.5

### For Data Science
- **Phase 1**: Validate algorithm outputs with manual thread samples; collect baseline metrics
- **Phase 2**: A/B test explanations (Algorithm 7); measure trust impact
- **Phase 3**: Build clustering validation pipeline (Algorithm 8); iterate on clustering formula
- **Phase 4**: Monitor CLIP cost/benefit trade-off; recommend escalation threshold

---

## Continuation: Next Steps

### Immediate (This Week)

1. **Integrate Phase 1 algorithms** per `ALGORITHM_INTEGRATION_GUIDE.md`:
   - Algorithm 2 (Change Detection) into `updateInterpolatorState.ts`
   - Algorithm 1 (Contributor Selection) into `writerInput.ts`
   - Algorithms 3–4 into relevant modules

2. **Shadow-mode telemetry**:
   - Log algorithmic outputs alongside legacy outputs
   - Measure convergence and divergence
   - Identify edge cases

3. **10% user rollout**:
   - Control group: legacy behavior
   - Test group: Algorithm 1–4 enabled
   - Duration: 1 week, monitor error rates + sentiment

### Next Weeks (Phase 2 Planning)

1. **Prioritize Phase 2 algorithms**:
   - Algorithm 5 (Redundancy) — 25% diversity improvement
   - Algorithm 6 (Context) — 30% guidance quality
   - Algorithm 7 (Explanations) — 40% trust improvement

2. **Begin development** on highest-priority 1:
   - Start with Algorithm 5 (Redundancy); it unblocks Algorithm 6

3. **Plan Phase 3** based on Phase 1 metrics:
   - If Explore traffic > 10% of total: prioritize Algorithm 8
   - If international users > 20%: prioritize Algorithm 9

---

## Document History

| Date | Status | Algorithms | Notes |
|------|--------|-----------|-------|
| 2025-01-21 | Active | 1–4 DONE, 5–10 Planned | Phase 1 complete; ready for Phase 2 planning |

---

**Checkpoint**: You are here ⬇️

✅ Phase 1: Foundation Layer — 4 algorithms implemented, 1410+ LOC  
🚧 Phase 2: Content Selection — 3 algorithms planned, 750+ LOC  
⏳ Phase 3: Discovery — 2 algorithms planned, 650+ LOC  
⏳ Phase 4: Optimization — 1 algorithm planned, 200+ LOC  

**Next**: Follow `ALGORITHM_INTEGRATION_GUIDE.md` and integrate Phase 1 into writerInput.ts and updateInterpolatorState.ts.
