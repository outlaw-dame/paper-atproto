# Router and coordinator architecture

This document defines the intended separation between the router model and the coordinator model in the intelligence architecture. These are related, but they are not the same component.

## Summary

The intelligence system uses two distinct orchestration roles:

1. **Router model**
   - Chooses the correct tool, lane, or provider for a bounded task.
   - Produces structured routing decisions, not product-facing interpretation.
   - Is allowed to be small and local-first.
   - FunctionGemma is the intended model family for this role when a learned router is needed.

2. **Coordinator runtime/model**
   - Oversees the overall intelligence session.
   - Ensures each task is executed by the right tool in the right order.
   - Applies privacy, availability, confidence, fallback, freshness, and source-token rules.
   - Reuses existing outputs when the underlying context has not meaningfully changed.
   - Owns system-level orchestration, not just individual tool selection.

The router answers: **What should handle this task?**

The coordinator answers: **What should the whole intelligence system do next, given state, policy, confidence, privacy, freshness, and available tools?**

## Router model

The router model is a specialized model for tool and lane selection. Its output must be structured, bounded, and schema-validated before execution.

Typical router inputs:

- task type
- data scope
- privacy mode
- user entitlement state
- device/runtime capability
- available providers
- confidence requirements
- latency/cost budget
- local-vs-edge-vs-server constraints

Typical router outputs:

```ts
interface RouterDecision {
  task: IntelligenceTask;
  lane: IntelligenceLane;
  provider?: IntelligenceProvider;
  tool?: ToolId;
  reasonCode: string;
  sendsPrivateText: boolean;
  requiresConsent: boolean;
  maxPayloadChars: number;
  fallbackLane?: IntelligenceLane;
}
```

The router model is not supposed to write summaries, decide truth, or synthesize user-facing prose. It routes to tools that do those jobs under coordinator supervision.

## FunctionGemma role

FunctionGemma is the intended learned-router model candidate because it is designed for function calling and small/local agent action selection. In this architecture, FunctionGemma should be used as a router only after the tool surface is explicitly declared and output schemas are enforced.

FunctionGemma should be used for:

- tool selection
- lane selection
- structured function-call planning
- provider selection among allowed providers
- deciding whether deterministic handling is sufficient or escalation is warranted

FunctionGemma should not be used for:

- full conversation interpretation
- final user-facing summaries
- unbounded reasoning over private text
- replacing deterministic policy checks
- directly executing tools without validation

FunctionGemma output must always be validated against a local schema before execution. Deterministic policy can override router output.

## Coordinator role

The coordinator is the runtime authority for the intelligence system. It may use router output, deterministic policy, provider health, and session state, but it remains responsible for final execution planning.

The coordinator should handle:

- task decomposition
- routing policy enforcement
- privacy/data-scope enforcement
- provider availability checks
- source-token guarding for async outputs
- stale output rejection
- retry/fallback sequencing
- model/tool result validation
- session state updates
- telemetry-safe diagnostics
- output reuse when context has not meaningfully changed

The coordinator is broader than the edge provider planner. The edge provider planner only maps edge lanes to concrete edge capabilities/providers/endpoints.

## Current implementation map

Current partial coordinator-like pieces:

- `src/conversation/sessionAssembler.ts`
  - Main conversation-session orchestration path for thread interpretation.
  - Fetches and resolves thread data, runs verified pipeline, gates writer/multimodal/premium paths, applies source-token guarding, and updates session state.

- `src/intelligence/intelligenceRoutingPolicy.ts`
  - Deterministic lane policy for tasks.
  - Defines whether work should stay local, go to browser small ML, edge classifier/reranker, server writer, premium provider, or browser experimental lane.

- `src/intelligence/edge/edgeProviderCoordinator.ts`
  - Narrow edge provider planner currently named as a coordinator.
  - Maps edge-eligible tasks to Cloudflare Workers AI or node heuristic providers where implemented.
  - This is not the full coordinator model.

- `server/src/ai/providerRouter.ts`
  - Provider router for premium API models such as Gemini/OpenAI.

## Intended high-level flow

```txt
User/system event
  -> deterministic context shaping
  -> coordinator runtime
  -> deterministic routing policy
  -> optional router model for structured tool/lane choice
  -> provider/capability planner
  -> task executor
  -> schema validation and safety filters
  -> coordinator applies freshness/source-token checks
  -> session/projection update
```

## Provider lanes

The coordinator must treat providers as replaceable execution options, not as the architecture itself.

- Browser heuristics: instant deterministic/private path.
- Browser small ML: local embeddings and lightweight local classification where appropriate.
- FunctionGemma router: local/edge-capable structured function routing after schema validation and testing.
- Cloudflare Workers AI: edge model provider for implemented edge capabilities.
- Node heuristic fallback: deterministic fallback when Cloudflare is unavailable for composer classification.
- Server writer/default model routes: bounded model execution behind Hono routes.
- Gemini/OpenAI: premium or high-depth provider-routed API model lanes.

## Privacy and safety rules

- Browser code must never receive Cloudflare REST API tokens, Gemini keys, OpenAI keys, or other provider secrets.
- FunctionGemma/router output is advisory until validated by deterministic policy.
- Coordinator policy can override router output.
- Local-only privacy mode must block remote/edge/API model execution.
- Provider output must not be trusted until schema validated.
- Async model output must be discarded when source tokens no longer match current state.
- Remote routes should use bounded payloads, no-store cache headers, retries with jitter where applicable, circuit breakers where appropriate, and stable fallback behavior.

## Naming rule

Do not call every planner a coordinator.

- The actual coordinator is the session/intelligence runtime that supervises task execution across local, edge, server, and premium-provider lanes.
- If a module only maps one lane to a provider endpoint, name it as a planner or provider router, not as the global coordinator.

## Implementation implication

Future work should introduce or extract a top-level intelligence coordinator boundary rather than expanding one-off endpoint logic. That coordinator should compose the existing `sessionAssembler`, routing policy, provider routers, edge planner, and task executors without duplicating their logic.
