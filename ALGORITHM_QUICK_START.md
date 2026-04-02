---
title: Algorithm Integration Quick Start
description: Copy-paste code snippets and exact file locations for rapid integration
created: 2025-01-21
status: Ready to Deploy
---

# Algorithm Integration Quick Start Guide

## Overview
This guide provides **copy-paste ready** code snippets for integrating Phase 1 algorithms. Follow in this order:

1. **Import Statements** (5 min)
2. **Integration Points** (30 min per algorithm)
3. **Testing** (15 min per algorithm)

---

## 1. Change Detection Integration (START HERE)

**File to modify**: `src/intelligence/updateInterpolatorState.ts`

### Step 1a: Add Import (1 min)

Copy this to the top of the file:

```typescript
import {
  createThreadSnapshot,
  computeThreadChangeDelta,
  shouldRateLimitUpdate,
  type ThreadStateSnapshot,
  type ThreadChangeDelta,
} from './algorithms';
```

### Step 1b: Add Interface to Track State (2 min)

If your Interpolator storage doesn't already have a snapshot, add this:

```typescript
interface InterpolatorCache {
  currentState: Interpolator;
  previousSnapshot?: ThreadStateSnapshot;
  lastUpdateTime: number;
}

// At module level or inside relevant function:
const interpolatorCache = new Map<string, InterpolatorCache>(); // keyed by threadUri
```

### Step 1c: Replace Timer-Based Update Logic (15 min)

**Find this** (or similar, your code may vary):
```typescript
if (Date.now() - lastUpdateTime > INTERPOLATOR_UPDATE_THRESHOLD) {
  // updateInterpolator() call here
}
```

**Replace with this**:
```typescript
// Get current cache
const cache = interpolatorCache.get(threadUri);
const previousSnapshot = cache?.previousSnapshot;

// Create current state snapshot
const currentSnapshot = createThreadSnapshot(
  thread,           // Current thread data
  contributors,     // Array of top contributors
  extractedEntities, // Entities mentioned in thread
);

// Rate limit check (prevents too-frequent updates)
const rateLimited = !shouldRateLimitUpdate(cache?.lastUpdateTime ?? 0, 60000); // 60s threshold
if (rateLimited) {
  console.log('[updateInterpolator] Rate limited, skipping update');
  return;
}

// Compute change delta
const changeDelta = computeThreadChangeDelta(previousSnapshot, currentSnapshot);

console.log('[updateInterpolator] Change detection:', {
  shouldUpdate: changeDelta.shouldUpdate,
  confidence: changeDelta.confidence,
  magnitude: changeDelta.changeDescription,
  reasons: changeDelta.changeReasons,
});

// Only update if meaningful change detected
if (!changeDelta.shouldUpdate) {
  console.log('[updateInterpolator] No significant change, skipping update');
  return;
}

// Update the Interpolator
const updatedInterpolator = await updateInterpolator({
  ...currentInterpolatorState,
  confidence: changeDelta.confidence,
  lastChangeReason: changeDelta.changeReasons[0],
  lastChangeTime: Date.now(),
});

// Store new snapshot for next comparison
interpolatorCache.set(threadUri, {
  currentState: updatedInterpolator,
  previousSnapshot: currentSnapshot,
  lastUpdateTime: Date.now(),
});
```

### Step 1d: Add to Interpolator Type (3 min)

If your Interpolator interface doesn't have these, add them:

```typescript
interface Interpolator {
  // ... existing fields ...
  
  // NEW: Algorithm-driven fields
  confidence?: number; // 0–1, confidence in this narrative
  lastChangeReason?: string; // Why did we update?
  lastChangeTime?: number; // When did we last update?
}
```

### Step 1e: Quick Test (5 min)

```typescript
// Manual test: log change detection results
const testThread = buildTestThread();
const snapshot1 = createThreadSnapshot(testThread, [], []);
const testThread2 = addReplyToThread(testThread, 'New reply');
const snapshot2 = createThreadSnapshot(testThread2, [], []);

const delta = computeThreadChangeDelta(snapshot1, snapshot2);
console.assert(delta.shouldUpdate === true, 'Should detect new reply as change');
console.assert(delta.changeReasons.length > 0, 'Should have reasons');
```

---

## 2. Contributor Selection Integration

**File to modify**: `src/intelligence/writerInput.ts`

### Step 2a: Add Import (1 min)

```typescript
import {
  selectContributorsAlgorithmic,
  selectContributorsLegacy,
  compareSelectionApproaches,
  type ContributorSelectionResult,
} from './algorithms';
```

### Step 2b: Replace Contributor Filtering (15 min)

**Find this** (or similar):
```typescript
const namedContributors = state.topContributors
  .filter(c => contributorMayBeNamed(c))
  .slice(0, 5);
```

**Replace with this**:
```typescript
// Use algorithmic selection
let selectionResult: ContributorSelectionResult;

try {
  selectionResult = selectContributorsAlgorithmic(
    state.topContributors,           // Contributor array
    state.contributorScores,         // Scores keyed by DID
    state.thread?.uri ?? '',         // Thread URI
    5,                               // Max contributors
  );
} catch (err) {
  console.error('[writerInput] Algorithm failed, falling back to legacy:', err);
  
  // Fallback: legacy behavior
  const legacyResult = selectContributorsLegacy(
    state.topContributors,
    state.contributorScores,
    5,
  );
  
  selectionResult = legacyResult;
}

const namedContributors = selectionResult.selected; // Use .selected field

// Optional: Log comparison (remove after tuning)
if (Math.random() < 0.01) { // Log 1% of calls to avoid spam
  const legacyResult = selectContributorsLegacy(
    state.topContributors,
    state.contributorScores,
    5,
  );
  
  const comparison = compareSelectionApproaches(selectionResult, legacyResult);
  console.log('[writerInput] Selection comparison:', {
    diversityGain: comparison.diversityImprovement,
    stanceBalance: selectionResult.coveredStances.length,
  });
}
```

### Step 2c: Pass to Composer (5 min)

Update wherever `namedContributors` feeds into composer guidance:

```typescript
// OLD:
showComposerGuidance(`Key voices: ${namedContributors.slice(0, 3).join(', ')}`);

// NEW:
if (selectionResult.coveredStances.length > 1) {
  const stanceLabels = {
    supporter: 'supporters',
    questioner: 'questioners',
    counterpoint: 'counterpoints',
    clarifier: 'fact-checkers',
  };
  
  const stances = selectionResult.coveredStances
    .map(s => stanceLabels[s] || s)
    .join(', ');
  
  showComposerGuidance(
    `Represented: ${stances}. Consider adding a different perspective.`
  );
}
```

### Step 2d: Quick Test (5 min)

```typescript
// Test algorithmic selection with diverse thread
const mockContributors = [
  { did: 'did1', avgUsefulnessScore: 0.9 }, // High impact
  { did: 'did2', avgUsefulnessScore: 0.7 }, // Medium
  { did: 'did3', avgUsefulnessScore: 0.6 }, // Medium
];

const mockScores = {
  did1: { agreementValue: 0.8, /* ... */ },
  did2: { clarificationValue: 0.7, /* ... */ },
  did3: { counterSupport: 0.7, /* ... */ },
};

const result = selectContributorsAlgorithmic(
  mockContributors,
  mockScores,
  'test-uri',
  3,
);

console.assert(result.selected.length > 0, 'Should select at least 1');
console.assert(result.coveredStances.length > 1, 'Should have diverse stances');
```

---

## 3. Entity Centrality Integration

**File to modify**: `src/intelligence/` (entity extraction module)

### Step 3a: Add Import (1 min)

```typescript
import {
  computeEntityCentralityScores,
  buildEntityCentralityResult,
  getTopCentralEntities,
  type EntityInfo,
} from './algorithms';
```

### Step 3b: Enhance Entity Extraction (20 min)

**Find this** (or similar):
```typescript
const entities = extractEntitiesFromThread(thread)
  .sort((a, b) => b.mentionCount - a.mentionCount)
  .slice(0, 10);
```

**Replace with this**:
```typescript
// Step 1: Extract raw entities
const rawEntities = extractEntitiesFromThread(thread);

// Step 2: Map to standard format
const entities: EntityInfo[] = rawEntities.map(e => ({
  id: e.canonicalId || e.id,
  label: e.label || e.displayName,
  type: e.type || 'topic', // 'topic' | 'event' | 'person' | 'team' | etc.
  mentionCount: e.mentions?.length ?? 0,
}));

// Step 3: Compute centrality
const entityScores = computeEntityCentralityScores(
  entities,
  thread.rootPost?.text ?? '',                         // Root post text
  new Set(thread.rootPost?.entities?.map(e => e.id) ?? []), // Root entities
  contributors,                                        // Contributor array
  contributorScores,                                   // Scores by DID
  replyOrder,                                          // DIDs in reply order
  buildMentionsByContributor(thread, contributors),    // Map: DID -> entity IDs
);

// Step 4: Build result
const result = buildEntityCentralityResult(entityScores);

// Step 5: Use top entities
const topEntities = getTopCentralEntities(result.entities, 5);

console.log('[entityCentrality] Analysis:', {
  topCentral: topEntities.map(e => e.entityLabel),
  themes: result.themes,
  diversity: result.entityDiversity,
});
```

### Step 3c: Helper Function (10 min)

Add this helper somewhere accessible:

```typescript
function buildMentionsByContributor(thread: Thread, contributors: ContributorImpact[]): Map<string, Set<string>> {
  const mentionsByDid = new Map<string, Set<string>>();
  
  for (const contributor of contributors) {
    mentionsByDid.set(contributor.did, new Set());
  }
  
  // Iterate posts, extract entities, assign to DIDs
  for (const reply of thread.replies) {
    const did = reply.author.did;
    if (!mentionsByDid.has(did)) {
      mentionsByDid.set(did, new Set());
    }
    
    const entities = extractEntitiesFromText(reply.text);
    for (const entity of entities) {
      mentionsByDid.get(did)?.add(entity.id);
    }
  }
  
  return mentionsByDid;
}
```

### Step 3d: Quick Test (5 min)

```typescript
const testEntities: EntityInfo[] = [
  { id: 'Q1', label: 'Root Topic', type: 'topic', mentionCount: 5 },
  { id: 'Q2', label: 'Incidental', type: 'topic', mentionCount: 1 },
];

const scores = computeEntityCentralityScores(
  testEntities,
  'About Root Topic', // Root text mentions it
  new Set(['Q1']),    // Root explicitly mentions Q1
  [],
  {},
  [],
  new Map(),
);

const result = buildEntityCentralityResult(scores);
console.assert(result.topCentral.length > 0, 'Should have central entities');
```

---

## 4. Stance Clustering Integration

**File to modify**: `src/intelligence/composerGuidance.ts` (or similar)

### Step 4a: Add Import (1 min)

```typescript
import {
  clusterStanceCoverage,
  filterByStanceDiversity,
  getStanceCoverageRecommendations,
} from './algorithms';
```

### Step 4b: Add to Composer Context (15 min)

```typescript
// When composer opens (in the guidance building function):

if (threadUri && threadState) {
  // Analyze stance coverage
  const clustering = clusterStanceCoverage(
    threadState.contributors,
    threadState.scores,
  );
  
  // Get recommendations
  const recommendations = getStanceCoverageRecommendations(clustering);
  
  console.log('[composerGuidance] Stance analysis:', {
    underrepresented: clustering.underrepresentedStances,
    overrepresented: clustering.overrepresentedStances,
    redundancy: clustering.redundancyLevel,
    recommendations,
  });
  
  // Show intelligent suggestions
  if (clustering.underrepresentedStances.length > 0 && recommendations.length > 0) {
    const stance = clustering.underrepresentedStances[0];
    const stanceDescriptions: Record<string, string> = {
      supporter: 'a supportive perspective',
      questioner: 'a clarifying question',
      counterpoint: 'an alternative viewpoint',
      clarifier: 'factual context',
      mediator: 'a bridging perspective',
      critic: 'a critical challenge',
    };
    
    const guidance = `Consider adding ${stanceDescriptions[stance] || 'a different perspective'}. ${recommendations[0]}`;
    
    showComposerGuidance(guidance);
  }
  
  // Suppress redundant contributors in preview
  if (clustering.suggestedSuppressions.length > 0) {
    const suppressedDids = clustering.suggestedSuppressions.map(s => s.did);
    hideSuppressedContributorsInPreview(suppressedDids);
  }
}
```

### Step 4c: Show Stance Badges (10 min)

In the composer thread summary, show represented stances:

```typescript
// Display which stances are represented
const clustering = clusterStanceCoverage(threadState.contributors, threadState.scores);

const representedStances = clustering.clusters
  .filter(c => c.contributors.length > 0)
  .map(c => ({
    label: c.description, // "Agrees & supports", "Asks & clarifies"
    color: stanceColorMap[c.stance], // Visual indicator
  }));

showStanceBadges(representedStances);
```

### Step 4d: Quick Test (5 min)

```typescript
// Test with supporter-heavy thread
const manyVoters = [
  { did: 'd1', avgUsefulnessScore: 0.8 },
  { did: 'd2', avgUsefulnessScore: 0.7 },
  { did: 'd3', avgUsefulnessScore: 0.6 },
];

const mockScores = {
  d1: { agreementValue: 0.9, /* ... */ },
  d2: { agreementValue: 0.8, /* ... */ },
  d3: { agreementValue: 0.7, /* ... */ },
};

const clustering = clusterStanceCoverage(manyVoters, mockScores);

console.assert(clustering.underrepresentedStances.length > 0, 'Should identify missing perspectives');
console.assert(clustering.stanceDiversity < 0.5, 'Should be low diversity');
```

---

## Testing Checklist

### Unit Tests (Run First)

```bash
npm test -- src/intelligence/algorithms/contributorSelection.test.ts
npm test -- src/intelligence/algorithms/changeDetection.test.ts
npm test -- src/intelligence/algorithms/entityCentrality.test.ts
npm test -- src/intelligence/algorithms/stanceClustering.test.ts
```

### Integration Tests (Then)

```bash
npm test -- src/intelligence/writerInput.test.ts
npm test -- src/intelligence/updateInterpolatorState.test.ts
```

### Manual Testing (Finally)

1. Open a complex thread in Glympse
2. Check browser console for algorithm logs
3. Verify:
   - Algorithm runs without errors
   - Fallback doesn't activate (unless testing fallback)
   - Output feeds correctly downstream
   - UI reflects algorithm decisions

---

## Rollback Plan

If something breaks:

```typescript
// Quick rollback: comment out algorithm call, use legacy
const namedContributors = selectContributorsLegacy(
  state.topContributors,
  state.contributorScores,
  5,
);
```

---

## Performance Check

After integration, verify no latency regression:

```typescript
// Add performance monitoring (temporary)
const start = performance.now();
const result = selectContributorsAlgorithmic(...);
const duration = performance.now() - start;

console.log(`Algorithm execution: ${duration.toFixed(1)}ms`);
console.assert(duration < 100, 'Should be <100ms'); // Tune threshold as needed
```

---

## Common Issues & Fixes

### Issue: "contributorScores is undefined"
**Fix**: Pass the scores object correctly. Check it matches the DID keys in contributors array.

### Issue: "createThreadSnapshot expects array, got undefined"
**Fix**: Make sure you're passing arrays (empty array [] is OK, null is not).

### Issue: Algorithm returns empty result
**Fix**: Check error logs in console. Add bounds checking on input arrays.

### Issue: Fallback called frequently
**Fix**: Add validation before algorithm call:
```typescript
if (!contributors || !scores || contributors.length === 0) {
  return selectContributorsLegacy(...); // Skip algorithm
}
```

---

## Next: Integration Validation

After finishing all integrations:

1. ✅ Run full test suite
2. ✅ Check for console errors
3. ✅ Verify shadow-mode telemetry logs
4. ✅ Compare 10% test group vs. control
5. ✅ Review metrics (coherence, quality, diversity)
6. ✅ Prepare for Phase 2 planning

---

**Status**: Ready to integrate. Estimated total time: 2 hours.  
**Start with**: Change Detection (Algorithm 2), then Contributor Selection (Algorithm 1).  
**Next phase**: Redundancy Suppression (Algorithm 5) — wait for Phase 1 validation first.
