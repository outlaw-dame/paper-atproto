# Router, coordinator, and writer architecture

This document records the intended separation between the router model, coordinator runtime/model, and writer model roles. These are separate jobs.

## Router model

The router answers: **what should handle this bounded task?**

The router should produce structured decisions such as task, lane, provider, tool, reason code, privacy behavior, payload budget, and fallback lane. It should not synthesize user-facing prose, decide truth, or replace deterministic policy.

FunctionGemma is the intended learned router-model candidate when we need model-assisted function or tool selection. FunctionGemma output must be schema-validated before use, and deterministic policy can override it.

Router responsibilities:

- tool selection
- lane selection
- provider selection among allowed providers
- structured function-call planning
- deciding whether deterministic handling is sufficient or escalation is warranted

## Coordinator runtime/model

The coordinator answers: **what should the whole intelligence system do next?**

The coordinator owns system-level orchestration. It may use router output, deterministic policy, provider health, and session state, but it remains responsible for final execution planning.

Coordinator responsibilities:

- task decomposition
- routing policy enforcement
- privacy and data-scope enforcement
- provider availability checks
- component status tracking
- source-token guarding for async outputs
- stale output rejection
- retry and fallback sequencing
- result validation
- session state updates
- reuse of existing outputs when context has not meaningfully changed

The first shared status vocabulary for coordinator supervision lives in `src/intelligence/modelRoles.ts`.

## Writer model role

The interpolator writer is not the router and is not the coordinator. It is a grounded prose-production role that may use validated context, but may not invent unsupported entities, claims, evidence, users, sources, facts, or relationships.

The recovered writer foundation lives in:

- `src/runtime/interpolatorWriterRoutingPolicy.ts`
  - Selects a valid writer execution plan across deterministic projection, local Qwen/Ollama, local or LiteRT Gemma, browser-small writer, Cloudflare Workers AI writer, and API enhancer writers.

- `src/runtime/interpolatorWriterEvalContract.ts`
  - Evaluates writer output against allowed entities, allowed claims, allowed evidence, required coverage, thinking-disclosure rules, and groundedness/quality/efficiency scores.

- `src/runtime/interpolatorWriterPromptContract.ts`
  - Builds the JSON-only prompt contract for raw writer candidates and explicitly passes allowed/required entity, claim, and evidence IDs.

Important rule: **do not invent entities** means do not fabricate unsupported entities. It does not mean ignore known entities. The writer should use supplied authors, participants, linked Wikidata/DBpedia entities, claims, and evidence when those are present in the fixture/grounding context.

## Current implementation map

- `src/conversation/sessionAssembler.ts`
  - Current thread/session orchestration path. It is the closest existing implementation of coordinator-like behavior.

- `src/intelligence/intelligenceRoutingPolicy.ts`
  - Deterministic lane policy for tasks.

- `src/intelligence/modelRoles.ts`
  - Shared role/status/action vocabulary for router, coordinator, writer, media, embedding, classification, reranking, entity linking, fact-check enrichment, projection, and component supervision.

- `src/intelligence/edge/edgeProviderPlanner.ts`
  - Narrow edge provider planner. It maps edge-eligible tasks to implemented edge providers and endpoints.
  - This is not the full coordinator.

- `src/runtime/interpolatorWriterRoutingPolicy.ts`
  - Writer-specific execution routing policy. This is separate from router/coordinator policy.

- `src/runtime/interpolatorWriterEvalContract.ts`
  - Writer grounding/evaluation contract.

- `src/runtime/interpolatorWriterPromptContract.ts`
  - Writer prompt/schema contract.

- `server/src/ai/providerRouter.ts`
  - Server-side provider router for premium API-model lanes.

## Intended high-level flow

```txt
User/system event
  -> deterministic context shaping
  -> coordinator runtime
  -> deterministic routing policy
  -> optional FunctionGemma router decision
  -> provider/capability planner
  -> task executor
  -> schema validation and safety filters
  -> coordinator freshness/source-token checks
  -> session/projection update
```

Writer-specific flow:

```txt
Validated conversation fixture
  -> writer routing policy
  -> writer prompt contract
  -> writer candidate output
  -> output adapter/finalizer
  -> writer eval contract
  -> coordinator accept/retry/fallback decision
```

## Provider lanes

The coordinator treats providers as replaceable execution options, not as the architecture itself.

- browser heuristics
- browser small ML
- FunctionGemma router
- Cloudflare Workers AI edge provider
- node heuristic fallback
- local writer models
- server writer/default model routes
- premium API-provider lanes

## Naming rule

Do not call every planner a coordinator.

A module that maps one lane to a provider endpoint should be named as a planner or provider router. The coordinator is the broader session/intelligence runtime that supervises work across local, edge, server, writer, router, media, and premium-provider lanes.

## Implementation implication

Future implementation should extract a top-level intelligence coordinator boundary that composes the existing session assembler, deterministic routing policy, router model, provider routers, edge planner, writer routing/eval/prompt contracts, and task executors without duplicating their logic.
