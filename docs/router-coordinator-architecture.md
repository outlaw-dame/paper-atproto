# Router and coordinator architecture

This document records the intended separation between the router model and the coordinator runtime/model. These are separate jobs.

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
- source-token guarding for async outputs
- stale output rejection
- retry and fallback sequencing
- result validation
- session state updates
- reuse of existing outputs when context has not meaningfully changed

## Current implementation map

- `src/conversation/sessionAssembler.ts`
  - Current thread/session orchestration path. It is the closest existing implementation of coordinator-like behavior.

- `src/intelligence/intelligenceRoutingPolicy.ts`
  - Deterministic lane policy for tasks.

- `src/intelligence/edge/edgeProviderPlanner.ts`
  - Narrow edge provider planner. It maps edge-eligible tasks to implemented edge providers and endpoints.
  - This is not the full coordinator.

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

## Provider lanes

The coordinator treats providers as replaceable execution options, not as the architecture itself.

- browser heuristics
- browser small ML
- FunctionGemma router
- Cloudflare Workers AI edge provider
- node heuristic fallback
- server writer/default model routes
- premium API-provider lanes

## Naming rule

Do not call every planner a coordinator.

A module that maps one lane to a provider endpoint should be named as a planner or provider router. The coordinator is the broader session/intelligence runtime that supervises work across local, edge, server, and premium-provider lanes.

## Implementation implication

Future implementation should extract a top-level intelligence coordinator boundary that composes the existing session assembler, deterministic routing policy, provider routers, edge planner, and task executors without duplicating their logic.
