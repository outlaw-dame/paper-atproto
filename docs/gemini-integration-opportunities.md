# Gemini Integration Opportunities

Date: 2026-03-31

## Current State (already integrated)

- Premium deep thread interpolation already runs on Gemini via server provider routing.
- Evidence verification already uses Gemini grounding with Google Search tool support.
- Main thread summary writer, media analyzer, search-story writer, and composer guidance currently run on local Qwen via Ollama.

## Highest-Impact Integration Targets

### 1) Hybrid writer path for core thread summaries (high impact, medium effort)

Why:
- The main thread summary drives most user-visible interpretation.
- Upgrading this path can lift quality for all users, not only premium tiers.

Current touchpoints:
- Server route: /api/llm/write/interpolator
- Service: server/src/services/qwenWriter.ts
- Client caller: src/intelligence/modelClient.ts

Suggested Gemini strategy:
- Add a provider abstraction for non-premium writer calls:
  - primary: local Qwen (latency/cost baseline)
  - fallback or confidence-triggered override: Gemini 2.5 Flash
- Trigger Gemini when:
  - interpretiveConfidence is low but surfaceConfidence is high (better synthesis)
  - selectedComments include high disagreement density
  - mediaFindings indicate high ambiguity

Implementation notes:
- Reuse existing retry/timeout/safety filtering flow.
- Keep current response schema unchanged to avoid UI changes.
- Add a provider field in diagnostics for A/B comparisons.

---

### 2) Gemini composer guidance rewriting (high impact, low-medium effort)

Why:
- Composer guidance is short-form and sensitive to tone quality.
- Gemini tends to produce stronger concise coaching and rewrite quality at low token cost.

Current touchpoints:
- Route: /api/llm/write/composer-guidance
- Service: server/src/services/qwenComposerGuidanceWriter.ts

Suggested Gemini strategy:
- Add optional Gemini provider behind env toggle.
- Keep existing safety checks and shaming detection post-processing.
- Start as fallback only, then roll to primary once metrics stabilize.

Success metrics:
- Higher acceptance rate of suggestions.
- Lower user edits after accepting suggestion.
- No increase in safety-filtered outputs.

---

### 3) Multimodal media analysis with Gemini Vision fallback (high impact, medium effort)

Why:
- Media-heavy threads are likely where local compact vision models underperform.
- Better OCR and visual grounding should improve caution flags and context extraction.

Current touchpoints:
- Route: /api/llm/analyze/media
- Service: server/src/services/qwenMultimodal.ts
- Verification pipeline also consumes media context: server/src/verification/verify-evidence.ts

Suggested Gemini strategy:
- Keep Qwen-VL as default for cost/local execution.
- Add Gemini multimodal path when:
  - OCR confidence appears low
  - cautionFlags include uncertainty
  - mediaCentrality is high and contradiction risk is high

Implementation notes:
- Preserve existing MediaResponse contract.
- Add provider provenance in logs for model-quality analysis.

---

### 4) Verification scoring upgrade with structured Gemini JSON (medium-high impact, medium effort)

Why:
- Current grounding uses Gemini text + grounding chunks, then derives scores heuristically.
- Asking Gemini for structured score components can reduce hand-tuned bias and improve explainability.

Current touchpoints:
- server/src/verification/gemini-grounding.provider.ts
- server/src/verification/verify-evidence.ts

Suggested Gemini strategy:
- Expand grounding prompt to request strict JSON fields:
  - support_level, contradiction_level, source_quality_signals, uncertainty_reasons
- Keep heuristic fallback when JSON parse fails.
- Blend model output with existing deterministic scoring (do not fully replace).

Implementation notes:
- Keep source extraction from grounding metadata as-is.
- Add versioned scoring metadata for regression tracking.

---

### 5) Discovery/search-story quality pass with Gemini (medium impact, low-medium effort)

Why:
- Explore synopsis quality improves retention in discovery surfaces.
- This path is already centralized and can be upgraded with minimal UI work.

Current touchpoints:
- Route: /api/llm/write/search-story
- Reuses writer logic in server/src/routes/llm.ts

Suggested Gemini strategy:
- Add dedicated synopsis writer provider using Gemini with strict schema.
- Use Qwen path as fallback to preserve availability.

## Not Recommended Immediately

- Replacing local embeddings with Gemini embeddings in current schema without migration planning.

Reason:
- Existing vector dimensions and index strategy are tightly coupled to current embedding pipeline and local vector DB setup.
- This change likely requires schema migration and re-indexing.

Current touchpoints:
- src/intelligence/embeddingPipeline.ts
- src/schema.ts
- src/db.ts

## Rollout Plan

### Phase 1 (1-2 weeks)
- Add provider toggle and fallback plumbing for composer guidance and search-story.
- Add provider-specific telemetry counters and error taxonomy.

### Phase 2 (2-3 weeks)
- Add hybrid path for core interpolator writer.
- Add Gemini multimodal fallback for high-centrality media threads.

### Phase 3 (2 weeks)
- Add structured verification JSON scoring and confidence blending.
- Calibrate thresholds from telemetry and safety outcomes.

## Suggested Environment Flags

- GEMINI_API_KEY
- GEMINI_WRITER_MODEL=gemini-2.5-flash
- GEMINI_COMPOSER_MODEL=gemini-2.5-flash
- GEMINI_MEDIA_MODEL=gemini-2.5-flash
- GEMINI_SYNOPSIS_MODEL=gemini-2.5-flash
- GEMINI_WRITER_ENABLED=false
- GEMINI_COMPOSER_ENABLED=false
- GEMINI_MEDIA_ENABLED=false
- GEMINI_SYNOPSIS_ENABLED=false

## Immediate Next Step

- Implement provider abstraction for /api/llm/write/composer-guidance first, because it has the best impact-to-risk ratio and already has strong safety post-processing.