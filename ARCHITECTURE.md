# paper-atproto — Architecture

> **North Star:** a local-first ATProto reader where deterministic resolution, bounded algorithms, and selectively-invoked models flow through one coherent interpretation system rather than a collection of disconnected AI features.

---

## Design Principles

| Principle | How the code applies it |
|---|---|
| **Deterministic first** | Resolver, thread shaping, heuristics, and ranking all execute before any remote model call. |
| **Algorithms decide** | Models synthesize language; bounded algorithms decide contributor inclusion, entity ranking, stance balance, and meaningful change. |
| **Remote models are advisory, not authoritative** | Server writers, multimodal analysis, and premium Gemini/OpenAI enrichment operate on an already-structured thread state instead of owning the primary truth. |
| **Security and privacy by default** | Browser clients never call Ollama, Gemini, or OpenAI directly; routes enforce origin checks, payload validation, sanitization, and least-privilege access. |
| **Fail soft, fail bounded** | Verification, multimodal, translation, and writer calls all degrade to deterministic behavior when confidence, policy, or upstream availability is weak. |
| **Local runtime stays explicit** | The worker classifier stack is always local; larger browser text generation is opt-in on capable devices; browser multimodal remains staged until safe. |

---

## One AI System

The app now has a single end-to-end interpretation architecture with six connected lanes:

| Lane | Responsibility | Primary entry points |
|---|---|---|
| **1. Deterministic substrate** | ATProto resolution, context shaping, heuristics, moderation-aware shaping | `src/lib/resolver/atproto.ts`, `src/intelligence/context/*`, `src/intelligence/heuristics/*` |
| **2. Decision layer** | Contributor selection, thread-change detection, entity centrality, stance coverage, comment diversity | `src/intelligence/algorithms/*`, `src/intelligence/redundancy.ts`, `src/intelligence/writerInput.ts`, `src/intelligence/updateInterpolatorState.ts` |
| **3. Evidence enrichment** | Verification, translation, media gating, factual and confidence blending | `src/intelligence/threadPipeline.ts`, `src/intelligence/verification/*`, `src/lib/i18n/threadTranslation.ts`, `src/intelligence/mediaInput.ts` |
| **4. Default model execution** | Server-side writer and multimodal analysis behind bounded contracts and safety filters | `src/intelligence/modelClient.ts`, `server/src/routes/llm.ts`, `server/src/services/qwenWriter.ts`, `server/src/services/qwenMultimodal.ts` |
| **5. Premium deep interpretation** | Higher-depth provider-routed Gemini/OpenAI interpolation for entitled users only | `server/src/routes/premiumAi.ts`, `server/src/ai/providerRouter.ts`, `server/src/ai/providers/geminiConversation.provider.ts`, `server/src/ai/providers/openAiConversation.provider.ts` |
| **6. Session and transport plane** | Durable AI sessions, replay lanes, presence, message state, telemetry | `src/aiSessions/*`, `server/src/routes/aiSessions.ts`, `server/src/ai/sessions/*` |

The older “dual pipeline” idea still exists, but only as two subflows inside this broader system:

- **Search / discovery flow** remains local-first and embedding-backed.
- **Thread interpretation flow** now runs through a verified, multi-stage orchestration path.

---

## End-to-End Thread Interpretation Flow

The authoritative orchestration path for thread understanding lives in [`src/conversation/sessionAssembler.ts`](src/conversation/sessionAssembler.ts).

### 1. Fetch and normalize

1. The client resolves the thread through `agent.getPostThread(...)`.
2. `resolveThread(...)` converts raw ATProto thread data into typed `ThreadNode`s.
3. `buildSessionGraph(...)` shapes the graph used by projections and UI surfaces.

Primary files:

- `src/conversation/sessionAssembler.ts`
- `src/lib/resolver/atproto.ts`
- `src/conversation/sessionGraph.ts`

### 2. Score, verify, and measure change

`runVerifiedThreadPipeline(...)` is the base interpretation pipeline:

1. `runInterpolatorPipeline(...)` computes the local reply-scoring state.
2. Contribution scores are lifted into richer `ContributionScores`.
3. Verification candidates are selected and verified with retry and concurrency limits.
4. Verification outcomes are merged back into the per-reply scores.
5. Thread change, confidence, and summary mode are computed.
6. Existing writer / multimodal / premium outputs are reused when the thread has not changed meaningfully, instead of rerunning remote model lanes on every refresh.

Primary files:

- `src/intelligence/threadPipeline.ts`
- `src/intelligence/atprotoInterpolatorAdapter.ts`
- `src/intelligence/verification/*`
- `src/intelligence/changeDetection.ts`
- `src/intelligence/confidence.ts`

### 3. Apply decision algorithms

The decision layer is not separate from the pipeline; it is consumed directly by writer shaping and interpolator updates.

Shipped integrations:

- **Contributor selection** via `selectContributorsAlgorithmic(...)`
- **Stance coverage** via `clusterStanceCoverage(...)` and `filterByStanceDiversity(...)`
- **Entity centrality** via `computeEntityCentralityScores(...)`
- **Meaningful thread change** via `computeThreadChangeDelta(...)`
- **Comment diversity suppression** via `selectDiverseComments(...)`

Primary files:

- `src/intelligence/writerInput.ts`
- `src/intelligence/updateInterpolatorState.ts`
- `src/intelligence/algorithms/*`
- `src/intelligence/redundancy.ts`

### 4. Safety and interpretation shaping

Before any writer is called, the session state is hardened and shaped:

- Moderation and user rules are applied.
- Mental-health crisis detection runs over root and high-salience replies.
- Interpretive confidence, continuity, thread-state, and trajectory are derived.

Primary files:

- `src/conversation/sessionAssembler.ts`
- `src/conversation/sessionPolicies.ts`
- `src/conversation/interpretive/*`
- `src/conversation/continuitySnapshots.ts`
- `src/lib/sentiment.ts`

### 5. Translation and multimodal gating

The system enriches the thread only when it has enough justification:

1. `translateWriterInput(...)` produces privacy-aware translation output.
2. `detectMediaSignals(...)` and `shouldRunMultimodal(...)` decide whether media matters.
3. `selectMediaForAnalysis(...)` chooses at most a bounded set of media items.
4. Remote multimodal analysis returns structured `WriterMediaFinding`s.

Primary files:

- `src/lib/i18n/threadTranslation.ts`
- `src/intelligence/mediaInput.ts`
- `src/intelligence/modelClient.ts`
- `server/src/routes/llm.ts`
- `server/src/services/qwenMultimodal.ts`

### 6. Default writer and premium deep interpolation

Once the thread state is fully shaped:

1. `buildThreadStateForWriter(...)` constructs a bounded writer payload.
2. `callInterpolatorWriter(...)` requests the default thread summary writer.
3. If the user is entitled and the thread warrants it, `callPremiumDeepInterpolator(...)` requests a provider-routed premium interpretation through Gemini or OpenAI.

Primary files:

- `src/intelligence/writerInput.ts`
- `src/intelligence/modelClient.ts`
- `server/src/routes/llm.ts`
- `server/src/routes/premiumAi.ts`
- `server/src/ai/providerRouter.ts`

### 7. Session transport and replay

AI sessions are a parallel control plane, not a separate interpretation engine:

- Session bootstrap, event/state/presence lanes, and generation status live behind `/api/ai/sessions/*`.
- Durable read proxies and telemetry exist for replay and observability.
- Production telemetry is admin-protected and not exposed to the browser by default.

Freshness note:

- Story hydration now uses a privacy-safe server watch stream (`/api/conversation/watch`) that emits minimal invalidation events for remote thread changes.
- Slow polling remains in place as a self-healing backstop when the watch stream drops or reconnects.
- The client now only reruns writer, multimodal, and premium interpretation lanes when the thread meaningfully changed or a prior writer result is missing.
- Delta resolution and summary-projection fallback telemetry are now exposed in the local runtime diagnostics panel so drift and self-healing are visible during development.

Primary files:

- `src/aiSessions/*`
- `server/src/routes/aiSessions.ts`
- `server/src/ai/sessions/*`

---

## Search and Discovery Flow

Search remains local-first, but it now shares the same architectural values as thread interpretation.

### Neeva Gist as a reference, not a template

Neeva Gist is useful here because it made the same core bet we are making: mobile discovery should feel more like navigating an interpreted narrative than paging through flat result lists. It was also a strategic response to an early generative-AI mobile problem: experiences were collapsing either into walls of text or into one-off generated images, without a strong in-between format for browsing. Its strongest ideas were not "AI answers the web for you" in the abstract, but a more concrete package:

- Instagram-like card/feed presentation instead of flat blue-link ranking
- a strong first-card synopsis before deeper source exploration
- multimedia-friendly presentation for queries where visuals matter
- a tap-driven sense of guided story progression rather than unstructured result dumping
- snackable, mobile-first chunks instead of article-length result framing
- privacy-first packaging that still aimed to preserve trust and source visibility

That said, Gist was built for whole-web search, while this app is explicitly bounded to ATProto graphs, user-connected feeds, thread structure, and the media already present in those networks. That difference matters architecturally.

What we borrow from Gist:

1. **Narrative packaging over flat lists**
	Discovery should feel like "show me the development" rather than "show me ten isolated matches."

2. **Progressive disclosure**
	A user should be able to get a quick synopsis, then expand into underlying posts, contributors, domains, and media without losing the evidence trail. That is the useful part of Gist's "snackable" design, without inheriting its tendency to over-direct the session.

3. **Media-aware presentation**
	Visual and multimedia posts should receive different packaging when the query or story actually warrants it.

4. **Trust through visible sourcing**
	Story cards, source capsules, contributor chips, and explanation metadata should make the retrieval logic legible. In this repo that also aligns with the broader privacy posture: bounded server mediation, explicit source surfaces, and no ad/tracking-driven ranking incentives.

What we explicitly do **not** copy from Gist:

- forcing every query through an immersive story flow
- making quick lookups slower or more theatrical than they need to be
- allowing generative packaging to outrun deterministic selection
- pretending whole-story cohesion exists before clustering and explanation layers are actually present

The main Gist lesson is not "make search look like stories." It is that immersive packaging only works when it preserves utility. Our ATProto adaptation therefore favors **glanceability first, guided depth second**.

### Current shipped path

1. Deterministic ATProto resolution extracts stable search signals.
2. Text embeddings are generated off-thread in the inference worker.
3. Local PGlite + pgvector hybrid search powers discovery.
4. Explore/story discovery modules project the results into UI surfaces.

Primary files:

- `src/search.ts`
- `src/intelligence/embeddingPipeline.ts`
- `src/workers/inference.worker.ts`
- `src/conversation/discovery/*`
- `src/tabs/ExploreTab.tsx`

### Where the Neeva-style ideas fit

The Neeva influence belongs primarily in **discovery architecture**, not as a new authoritative model lane.

What maps cleanly onto the current system:

1. **Query understanding before ranking**
	Search now classifies whether the user is asking for a person, topic, source, feed, hashtag, or media-heavy result set before weights and surfaces are chosen. The current local-first hooks already exist in `src/search.ts`, `src/conversation/discovery/exploreSearch.ts`, `src/conversation/discovery/discoveryIntent.ts`, and `src/conversation/discovery/exploreDiscovery.ts`.

2. **Evidence-packaged result presentation**
	Neeva-style cards map directly to the shipped projection layer: session-backed synopsis text, best-source selection, related entities, domain extraction, intent labels, explanation chips, and discovery cards already flow through `src/conversation/projections/storyProjection.ts`, `src/conversation/discovery/exploreProjection.ts`, and `src/tabs/ExploreTab.tsx`.

3. **Story grouping over flat lists**
	The strongest unshipped Neeva-aligned opportunity is first-class story clustering for Explore, so discovery feels like grouped developments around an event or topic instead of only ranked posts.

4. **Explanation surfaces**
	Neeva-style trust comes from showing why something surfaced. This is now partially shipped through bounded explanation metadata such as intent labels, story/source evidence reasons, and selection chips. The remaining work is deeper, user-facing explanation for “why this cluster,” “why this contributor,” and “why this summary,” still produced by deterministic selectors rather than freeform model output.

What does **not** map cleanly:

- A search-answer engine replacing the verified thread pipeline
- A heavy reranking stage as the default path for all queries
- Remote generative summarization deciding truth before deterministic selection and verification

### Current limitation

Search is coherent, intent-aware, and local-first, but it is not yet driven by the full story-clustering algorithm described in the roadmap. That remains planned work rather than hidden behavior.

### Product lesson taken directly from Gist

Gist appears to have succeeded most on visually rich, exploratory, or hobby-like queries, and struggled on fast utilitarian lookups because the interface was too directive. That lesson transfers directly:

- Explore should support **story mode** without making it the only mode.
- Cards should summarize quickly, not force unnecessary interaction depth.
- Swipeable or sequential presentation should remain an enhancement, not a requirement for understanding.
- Repetition between cards or summaries is a quality failure, not a stylistic choice.
- Discovery should feel useful first and impressive second.

For this codebase, the right target is not "an ATProto version of Gist." The right target is **an ATProto-native conversation and discovery system that keeps Gist's packaging strengths while avoiding its utility failures.**

---

## Composer Guidance Flow

Composer guidance is part of the same architecture, not a standalone AI feature.

### Flow

1. `buildReplyComposerContext(...)` or `buildHostedThreadComposerContext(...)` shapes the authoring context.
2. `analyzeComposerGuidanceImmediate(...)` runs the immediate local path.
3. `analyzeComposerGuidance(...)` runs the async staged path.
4. Optional server writer polish is requested only after local scoring is already available.

Primary files:

- `src/intelligence/composer/contextBuilder.ts`
- `src/intelligence/composer/guidancePipeline.ts`
- `src/intelligence/composeTonePipeline.ts`
- `src/hooks/useComposerGuidance.ts`
- `server/src/services/qwenComposerGuidanceWriter.ts`

### What this means architecturally

Composer guidance is another consumer of the same principles:

- deterministic context first
- bounded local models second
- remote copy polish last
- always with local fallback UI text

---

## Local Runtime Boundaries

The browser runtime is intentionally conservative.

### Shipped today

- The classifier / scoring worker stack is local and always available as the hot path.
- Browser text generation can be enabled on capable devices through the runtime policy layer.
- Remote fallback remains available for heavier features.

Primary files:

- `src/runtime/modelPolicy.ts`
- `src/runtime/modelManager.ts`
- `src/components/LocalAiRuntimeSection.tsx`

### Intentionally not shipped yet

- Local browser multimodal generation is **planned/staged**, not treated as production-ready.
- Remote multimodal analysis is still the supported path when media interpretation is needed.

This boundary is deliberate: capability policy may allow multimodal in principle, but browser VLM runtime support is not presented as production-ready until the local path is safe.

---

## Security, Privacy, and Resilience

These are part of the architecture, not post-hoc add-ons.

### Browser / server boundaries

- The browser never calls Ollama, Gemini, or OpenAI directly.
- All model traffic is proxied through Hono routes with schema validation.
- Premium routes require DID headers and trusted origins.

Primary files:

- `server/src/routes/llm.ts`
- `server/src/routes/premiumAi.ts`
- `server/src/routes/aiSessions.ts`

### Validation and sanitization

- Zod-backed input parsing and output validation gate model I/O.
- URL sanitization, Safe Browsing checks, and no-store headers protect remote processing and sensitive data paths.
- Google Fact Check Tools belongs to the conversation OS verification lane: extracted text claims use `claims:search`, public media evidence can use `claims:imageSearch`, and matches flow into `knownFactCheckMatch`, fact-check chips, and factual confidence.
- Google Safe Browsing remains a URL threat preflight only. It can block unsafe URLs before link previews or remote media processing, but it is not treated as factual corroboration.
- Session-level interpretive confidence remains authoritative in `src/conversation/interpretive/*`; Google Fact Check and grounding outputs sharpen evidence adequacy, source integrity, contradiction handling, and structured explanation reasons there rather than creating a parallel epistemic stack.
- Discovery coverage-gap analysis is cluster context, not a second thread score. It feeds discovery presentation policy while session scoring keeps its local coverage-gap proxy as a bounded fallback.
- Writer and multimodal outputs are filtered before use.

Primary files:

- `server/src/llm/schemas.ts`
- `server/src/llm/policyGateway.ts`
- `server/src/lib/sanitize.ts`
- `server/src/services/safetyFilters.ts`
- `server/src/routes/verification.ts`
- `server/src/verification/google-fact-check.provider.ts`
- `src/conversation/interpretive/*`
- `src/conversation/discovery/coverageGap.ts`
- `src/conversation/projections/discoveryModePolicy.ts`
- `src/lib/safety/*`

### Retry, backoff, and bounded failure

- Network and verification calls use bounded retries.
- LLM routes use circuit breakers.
- Durable session reads/writes have explicit timeouts, retry attempts, and fail-open/fail-closed controls.

Primary files:

- `src/intelligence/modelClient.ts`
- `src/intelligence/verification/retry.ts`
- `server/src/lib/circuit-breaker.ts`
- `server/src/config/env.ts`

### Telemetry protection

- AI session telemetry is admin-protected in production through `AI_SESSION_TELEMETRY_ADMIN_SECRET`.
- The browser runtime panel disables telemetry inspection outside local development.

Primary files:

- `server/src/routes/aiSessions.ts`
- `src/components/LocalAiRuntimeSection.tsx`

---

## Shipped vs Planned

### Shipped

- Verified thread pipeline
- Phase 1 decision algorithms integrated into real code paths
- Comment-level redundancy suppression
- Discovery intent routing for people / feed / source / hashtag / visual queries
- Explore explanation metadata for why stories and sources surfaced
- Remote multimodal gating and analysis
- Premium deep interpolation entitlement lane
- AI session transport with durable replay protections

### Planned

- Story clustering for Explore
- Deeper explanation generation for user-visible algorithm reasons
- Context summarization selector for tighter composer context packing
- Translation selection algorithm
- Multimodal escalation algorithm for search-time visual specialization
- Production-safe local browser multimodal runtime

---

## Canonical Files

If you only read a small slice of the codebase, start here:

1. `src/conversation/sessionAssembler.ts`
2. `src/intelligence/threadPipeline.ts`
3. `src/intelligence/writerInput.ts`
4. `src/intelligence/algorithms/index.ts`
5. `server/src/routes/llm.ts`
6. `server/src/routes/premiumAi.ts`
7. `server/src/routes/aiSessions.ts`

These files describe the real system more accurately than any historical planning notes.
