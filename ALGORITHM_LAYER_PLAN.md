# Algorithmic Layer Implementation Plan

**Status**: Analysis phase  
**Date**: April 1, 2026  
**Scope**: Add deterministic decision-making layer between heuristics/signals and models

---

## Executive Summary

Glympse has excellent infrastructure (deterministic substrate, off-thread inference, verification pipeline, composer guidance), but lacks the middle algorithmic layer that makes **coherent, repeatable decisions** about:

- ✅ Who to name (fixed threshold gate)
- ✅ Which replies to include (top-N slice)
- ❌ **How to suppress redundancy**
- ❌ **Why this summary instead of that one**
- ❌ **When the thread actually changed meaningfully**
- ❌ **What story clusters should exist**

This creates the "close but disconnected" feeling. The system interprets well but **decides poorly**.

---

## Gap Analysis: Current State vs. Target State

### 1. Contributor Inclusion (Currently Threshold-Based)

**Location**: [`src/intelligence/routing.ts`](src/intelligence/routing.ts#L65) + [`src/intelligence/writerInput.ts`](src/intelligence/writerInput.ts#L104)

**Current logic**:
```typescript
// Just a gate:
contributorMayBeNamed(impactScore, isOp, summaryMode) {
  if (isOp) return true;
  if (summaryMode === 'normal') return impactScore >= 0.50;
  return impactScore >= 0.68;
}

// Then slice:
.filter(c => contributorMayBeNamed(...))
.slice(0, 5)
```

**Problem**: Picks highest-scoring contributors, but:
- No distinctiveness scoring
- No redundancy suppression
- No stance coverage logic
- No "why named" reasoning
- Can pick 3 people saying the same thing

**Target**:
```typescript
// Algorithm-driven:
contributorInclusionScore =
  0.30 * impact
+ 0.20 * distinctiveness
+ 0.15 * sourceSupport
+ 0.15 * threadShiftValue
+ 0.10 * stanceRepresentativeness
+ 0.10 * clarificationValue
- 0.20 * redundancy
```

**Urgency**: **HIGHEST** — Clearest Narwhal parity gap

---

### 2. Meaningful Thread-Change Detection (Currently Missing)

**Location**: [`src/intelligence/updateInterpolatorState.ts`](src/intelligence/updateInterpolatorState.ts) (inferred)

**Current logic**: 
- Updates when new replies arrive
- Has some meaningful-trigger detection
- But no **change magnitude** algorithm

**Problem**:
- Interpolator rewrites too often (new reply → new summary)
- Should update only when:
  - New stance enters
  - Source-backed clarification changes understanding
  - Major contributor enters/exits
  - Heat level shifts materially

**Target**:
```typescript
changeMagnitude =
  0.25 * newAngleDelta
+ 0.20 * contributorShift
+ 0.15 * entityShift
+ 0.15 * factualShift
+ 0.15 * heatDelta
+ 0.10 * repetitionDelta
```

**Urgency**: **HIGHEST** — Makes Interpolator feel alive

---

### 3. Entity Centrality Ranking (Currently Extracted Only)

**Location**: Scattered across [`src/intelligence/entityLinking.ts`](src/intelligence/entityLinking.ts), [`src/tabs/ExploreTab.tsx`](src/tabs/ExploreTab.tsx)

**Current logic**:
- Extract entities from posts + links
- No unified centrality model
- Explore uses surface-local clustering
- Story uses per-surface extraction

**Problem**:
- Entities shown as "co-mentioned" but not ranked by importance
- Story doesn't feel graph-native
- Explore not truly story-first

**Target**:
```typescript
entityCentrality =
  0.25 * rootPresence
+ 0.20 * weightedMentions
+ 0.15 * contributorImpactMentions
+ 0.15 * sourceAssociation
+ 0.10 * temporalBurst
+ 0.10 * clusterAlignment
+ 0.05 * canonicalConfidence
```

**Urgency**: **VERY HIGH** — Needed for true graph-native story discovery

---

### 4. Stance Coverage Clustering (Currently Implicit)

**Location**: [`src/intelligence/writerInput.ts`](src/intelligence/writerInput.ts) — no explicit clustering

**Current logic**:
- Select top-scoring replies
- No stance grouping
- Can overrepresent one viewpoint

**Problem**:
- Three people saying "agree" but scored high all get named
- Summaries feel repetitive instead of coherent
- Missing explicit stance diversity

**Target**:
```typescript
// Cluster replies by:
- Stance agreement/disagreement
- Entity focus
- Source overlap
- Same-role duplication
- Semantic similarity

// Then select:
- Dominant stance representative
- Strongest clarifier
- Meaningful counterpoint (if <80% agreement)
- Source-bringer (if present)
```

**Urgency**: **VERY HIGH** — Directly fixes repetition problem

---

### 5. Story Clustering for Explore (Currently Provisional)

**Location**: [`src/tabs/ExploreTab.tsx#L109`](src/tabs/ExploreTab.tsx#L109) — `scorePostEngagement()`

**Current logic**:
```typescript
function scorePostEngagement(post: MockPost): number {
  // Engagement-only ranking
  // No clustering signals
}
```

**Problem**:
- Explore is engagement-first, not story-first
- No unified clustering substrate
- Can't feed story discovery properly

**Target**:
```typescript
storyClusterScore =
  0.25 * quoteOverlap
+ 0.20 * domainOverlap
+ 0.20 * entityOverlap
+ 0.20 * embeddingSimilarity
+ 0.10 * hashtagOverlap
+ 0.05 * temporalProximity
```

**Urgency**: **HIGH** — Needed for story-first Explore

---

### 6. Redundancy Suppression (Currently None)

**Location**: Missing; needed in contributor selection + comment ranking

**Current logic**: None — just rank and slice

**Problem**:
- Replaces semantic/role duplicates with model calls
- Composer guidance doesn't know it's in a pile-on
- Summary can list 3 similar comments

**Target**:
```typescript
// After selecting one comment/contributor:
// Penalize similar later candidates by:
- 0.30 * semanticSimilarity
- 0.25 * roleOverlap
- 0.20 * stanceOverlap
- 0.15 * entityOverlap
- 0.10 * sourceOverlap
```

**Urgency**: **HIGH** — Fixes immediate redundancy

---

### 7. Context Summarization for Composer (Currently Raw Arrays)

**Location**: [`src/intelligence/composer/contextBuilder.ts`](src/intelligence/composer/contextBuilder.ts) (inferred)

**Current logic**: Passes raw parent/thread/reply arrays to guidance

**Problem**:
- Guidance sees full context, not distilled state
- Can't reason about pile-on, heat level, clarity status
- Guidance scoring is harder than needed

**Target**:
```typescript
interface ContextSnapshot {
  directParentSummary: { sentiment, keyPoints, heatLevel }
  threadSummary: { dominantStance, minorCounterpoint, heatTrajectory }
  replyContextSummary: { nearbyReplies, pileOnDetected }
  conversationHeatSummary: { currentHeat, trendDirection, escalationRisk }
}
```

**Urgency**: **HIGH** — Improves guidance reasoning

---

### 8. Explanation-Reason Generation (Currently Post-Hoc)

**Location**: [`src/intelligence/explanations.ts`](src/intelligence/explanations.ts) — doesn't exist yet

**Current logic**: Verification has reasons; routing doesn't

**Problem**:
- "Why this summary" is inferred from thresholds, not explicit
- No machine-readable reason for entity inclusion
- Can't improve reasoning without changing weights

**Target**:
```typescript
interface DecisionReason {
  criterion: 'clarified_core' | 'new_angle' | 'source_backed' | 
            'represents_stance' | 'thread_forming' | ...
  confidence: 0-1
  evidence: string  // Machine-readable: what signal triggered this
}
```

**Urgency**: **MEDIUM-HIGH** — Trust/transparency

---

### 9. Translation-Selection Algorithm (Currently All-or-Nothing)

**Location**: [`src/features/translation/translationSelection.ts`](src/features/translation/translationSelection.ts) — doesn't exist

**Current logic**: Toggle translation on/off; no selective translation

**Problem**:
- Can't translate only high-signal content
- Story/Explore don't optimize translation load
- Language mismatch slows discovery

**Target**:
```typescript
// Translate:
- Root post
- Selected high-signal replies (top 3-5)
- Visible story snippets
- Entity snippets on demand

// Do NOT translate:
- Entire thread eagerly
- Low-impact comments
- Comments selected for composer only
```

**Urgency**: **MEDIUM** — Optimization, not core feature

---

### 10. Multimodal-Escalation Algorithm (Currently Heuristic)

**Location**: [`src/intelligence/routing.ts`](src/intelligence/routing.ts) — routing exists but could be stronger

**Current logic**: Route based on presence of media

**Problem**:
- Runs multimodal on every image, not just relevant ones
- No understanding of whether image changes meaning
- Cost/latency hit on low-value media

**Target**:
```typescript
// Escalate to Qwen3-VL only when:
- Screenshot/document/chart is central to claim
- OCR-heavy media matters
- Replies reference the image
- Provenance ambiguity exists
- Text-only understanding inadequate
```

**Urgency**: **MEDIUM** — Later phases

---

## Implementation Sequence: Build Priority & Risk/Complexity

### Phase 1 (Week 1): The Three Most Urgent

| Algorithm | Files | LOC | Risk | Complexity | Expected Lift |
|-----------|-------|-----|------|-----------|---|
| **1. Contributor Inclusion** | `contributorSelection.ts` (new) + `writerInput.ts` (refactor) | 200 | Low | Medium | +30% parity w/ Narwhal |
| **2. Thread-Change Detection** | `changeDetection.ts` (new) + `updateInterpolatorState.ts` (refactor) | 250 | Low | Medium | +50% Interpolator coherence |
| **3. Entity Centrality** | `entityCentrality.ts` (new) + `Explore/Story` (refactor) | 300 | Medium | High | +40% story coherence |

**Total**: ~750 LOC, 1-2 weeks, unblocks everything else

### Phase 2 (Week 2): The High-Impact Supporters

| Algorithm | Files | LOC | Risk |
|-----------|-------|-----|------|
| 4. Stance Coverage | `stanceClustering.ts`, `writerInput.ts` | 250 | Low |
| 5. Story Clustering | `clusterService.ts`, `ExploreTab.tsx` | 300 | Medium |
| 6. Redundancy Suppression | `redundancy.ts`, `contributorSelection.ts` | 150 | Low |

**Total**: ~700 LOC, 1 week

### Phase 3 (Week 3): Infrastructure & Polish

| Algorithm | Files | LOC | Risk |
|-----------|-------|-----|------|
| 7. Context Summarization | `composer/contextSummarizer.ts` | 200 | Low |
| 8. Explanation Reasons | `explanations.ts` | 180 | Low |
| 9. Translation Selection | `translation/selectionAlgorithm.ts` | 150 | Low |
| 10. Multimodal Escalation | `routing.ts` (strengthen) | 100 | Low |

**Total**: ~630 LOC, 1 week

---

## Error Handling & Security Considerations

All algorithms must include:

### 1. **Input Validation & Sanitation**
```typescript
// All numeric inputs must be clamped
const contributorScore = Math.max(0, Math.min(1, ...))

// All string inputs must be length-checked
const entityLabel = label.slice(0, 128).trim()

// Null/undefined safety
const impact = contributor?.avgUsefulnessScore ?? 0
```

### 2. **Exponential Backoff for External Calls**
```typescript
// Entity lookups, verification calls, etc. must retry with backoff
async function callWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 100,
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay + Math.random() * 1000);
    }
  }
}
```

### 3. **Privacy Preservation**
```typescript
// Algorithms must NOT log PII
// Contributors: use DIDs, not handles (in logs)
// Entities: use canonical IDs, not user text
// Never log full post content
```

### 4. **Rate-Limiting & Resource Guards**
```typescript
// Long-running algorithms must have timeouts
const contribution = await Promise.race([
  computeContributorInclusion(...),
  new Promise((_, reject) => setTimeout(() => reject('timeout'), 5000))
])

// Array operations must bound size
const candidates = topScores.slice(0, 100) // Never compute on unbounded lists
```

### 5. **Confidence Composition**
```typescript
// Never return NaN or Infinity
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, isFinite(value) ? value : 0))
}

// Always include confidence in outputs
return {
  decision: decided,
  confidence: 0.87,  // How much to trust this choice
  fallbackBehavior: 'slice_top_5',  // What to do if confidence < 0.50
}
```

---

## File Structure: Where Algorithms Live

```
src/intelligence/
├── scoreThread.ts (existing — stays)
├── threadPipeline.ts (existing — light refactoring)
├── verification/ (existing — stays)
│
├── algorithms/ (NEW)
│  ├── contributorSelection.ts (1. Contributor inclusion)
│  ├── changeDetection.ts (2. Meaningful thread change)
│  ├── stanceClustering.ts (4. Stance coverage)
│  ├── redundancy.ts (6. Redundancy suppression)
│  └── explanations.ts (8. Explanation-reason generation)
│
├── entities/
│  ├── entityCentrality.ts (NEW; 3. Entity centrality ranking)
│  └── entityStore.ts (refactor to use centrality)
│
├── composer/
│  └── contextSummarizer.ts (NEW; 7. Context summarization)
│
├── routing.ts (refactor to strengthen multimodal escalation)
└── llmContracts.ts (add reason enums)

src/features/
├── explore/
│  ├── clusterService.ts (NEW; 5. Story clustering)
│  ├── useLiveClusters.ts (NEW)
│  └── ... (refactor ExploreTab)
│
└── translation/
   └── selectionAlgorithm.ts (NEW; 9. Translation selection)
```

---

## Data Contracts: Core Types

All algorithms share these contracts:

```typescript
// From existing types
interface ContributionScores {
  uri: AtUri
  role: ContributionRole
  finalInfluenceScore: number  // 0–1
  clarificationValue: number   // 0–1
  sourceSupport: number        // 0–1
  factual: FactualEvidence | null
}

interface ThreadNode {
  uri: string
  authorDid: string
  authorHandle?: string
  text: string
  createdAt: string
  likeCount: number
}

interface InterpolatorState {
  topContributors: ContributorImpact[]
  entities: EntityInfo[]
  majorThemes: string[]
  confidence: ConfidenceState
}

// NEW: Decision outputs
interface AlgorithmicDecision<T> {
  value: T
  confidence: 0–1
  reasons: DecisionReason[]
  fallback?: T  // What to do if confidence < threshold
}

interface DecisionReason {
  criterion: string  // e.g., 'clarified_core', 'represents_stance'
  confidence: 0–1
  weight: 0–1
  score: number  // Raw contribution to decision
}
```

---

## Testing Strategy

For each algorithm:

1. **Unit tests**: Mock data, verify scoring logic
2. **Integration tests**: With real thread data from local DB
3. **Regression tests**: Ensure existing thresholds still work
4. **Telemetry**: Track algorithm vs. old-logic agreement

Example:
```typescript
// tests/intelligence/algorithms/contributorSelection.test.ts
describe('contributorInclusionScore', () => {
  it('should suppress redundant high-scorers', () => {
    const sameSentiment = [
      { role: 'clarifying', score: 0.9, ... },
      { role: 'clarifying', score: 0.85, ... },
    ]
    const selected = selectContributors(sameSentiment, { maxCount: 2 })
    expect(selected).toHaveLength(1)  // One suppressed
  })

  it('should preserve stance diversity', () => {
    const diverse = [
      { role: 'clarifying', sentiment: 'agree', score: 0.9 },
      { role: 'counterpoint', sentiment: 'disagree', score: 0.7 },
    ]
    const selected = selectContributors(diverse, { maxCount: 2 })
    expect(selected).toHaveLength(2)  // Both kept for coverage
  })
})
```

---

## Success Metrics

| Phase | Metric | Target | Measurement |
|-------|--------|--------|---|
| 1 | Narwhal feature parity | +30% | User feedback, screenshot comparison |
| 1 | Interpolator coherence | +50% | Do rewrites feel justified? (survey) |
| 2 | Redundancy suppression | >90% | Same-role dedup rate, summary diversity |
| 3 | Trust/transparency | Higher | "I understand why this" feedback |

---

## Integration Checkpoints

Before each phase:
- [ ] Type contracts reviewed and agreed
- [ ] Test data prepared (real threads from local DB)
- [ ] Existing code paths audited (identify refactoring scope)
- [ ] Telemetry hooks added (compare old vs. new)

After each phase:
- [ ] Unit tests pass (98%+ coverage on algorithm code)
- [ ] Integration tests with real threads pass
- [ ] No regression in existing features
- [ ] Telemetry shows expected improvement
- [ ] Code review complete

---

## Next Step

Implement **Phase 1, Algorithm 1: Contributor Inclusion Selection** in detail with:
- Full type contracts
- Error handling stubs
- Test data
- Integration points with existing writerInput.ts

This is the foundational algorithm — all others depend on its patterns.
