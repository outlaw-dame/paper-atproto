# Architecture recovery index

This document prevents architecture drift by recording prior branch work before new implementation starts. Any future router, coordinator, writer, model-routing, Cloudflare Workers AI, or intelligence-runtime PR should check this index first.

## Recovery rule

Before implementing a major intelligence feature:

1. Search existing branches for related work.
2. Compare candidate branches against current `master`.
3. Classify each branch as already merged, partially recovered, needs recovery, superseded, or unsafe/stale.
4. Recover contracts before runtime integration.
5. Prefer small PRs with CI gates over large branch merges.
6. Do not rename a planner/coordinator/router role without checking this document and `docs/router-coordinator-architecture.md`.

## Confirmed branch families

### Interpolator writer chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/interpolator-writer-routing-policy` | Foundational writer-routing work; equivalent files are already present on `master`. | Keep as historical source material. |
| `feat/interpolator-writer-eval-contract` | Foundational writer-evaluation work; equivalent files are already present on `master`. | Keep as historical source material. |
| `feat/interpolator-writer-prompt-contract` | Foundational prompt-grounding contract; equivalent files are already present on `master`. | Keep as historical source material. |
| `feat/interpolator-writer-output-adapter` | Foundational output-adapter work; equivalent files are already present on `master`. | Keep as historical source material. |
| `fix/interpolator-writer-output-adapter-review` | Direct source/test comparison against `master` shows no remaining output-adapter delta. | Keep as historical source material. |
| `feat/interpolator-writer-fallback-controller` | Fallback controller and tests are recovered on `master`. | Keep as historical source material. |
| `feat/interpolator-writer-execution-finalizer` | Execution finalizer and tests are recovered on `master`. | Keep as historical source material. |
| `feat/interpolator-writer-eval-harness` | Eval harness source and tests are recovered on `master`. | Keep as historical source material. |
| `fix/interpolator-writer-eval-harness-fixture-test` | Fixture mismatch eval/test fix is recovered on `master`. | Keep as historical source material. |

### Router and coordinator chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/router-coordinator-contract` | Foundational contract and diagnostics work is merged; direct diagnostics file comparison against `master` shows no remaining source/test delta. | Keep as historical source material. |
| `feat/router-coordinator-prompts` | Router/coordinator prompt work is present on `master`; direct prompt/runtime source comparison shows no remaining source delta. | Keep as historical source material. |
| `feat/router-authority-advisory-profile` | Fully behind `master` with zero commits ahead. | Keep as historical source material. |
| `feat/router-runtime-adapter` | Direct runtime source/test comparison against `master` shows no remaining local-runtime delta. | Keep as historical source material. |
| `feat/router-coordinator-shadow-evaluator` | Fully behind `master` with zero commits ahead. | Keep as historical source material. |
| `feat/router-coordinator-shadow-diagnostics` | Fully behind `master` with zero commits ahead. | Keep as historical source material. |
| `feat/router-coordinator-diagnostics-ui` | Fully behind `master` with zero commits ahead. | Keep as historical source material. |
| `fix/router-coordinator-route-diagnostics` | Direct diagnostics file comparison against `master` shows no remaining source/test delta. | Keep as historical source material. |
| `fix/land-router-runtime-boundary` | Runtime boundary files and enhancer quality fallback are present on `master`; direct source comparison shows no remaining runtime-boundary delta. | Keep as historical source material. |

### FunctionGemma router chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/functiongemma-router-invoker-boundary` | Foundational invoker, execution adapter, local runtime, and FunctionGemma tests are merged; enhancer fallback logic from this branch family is represented by `enhancerQualityFallback` on `master`. | Keep as historical source material. |
| `fix/functiongemma-load-errors` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |
| `fix/functiongemma-load-error-reporting` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |
| `fix/functiongemma-load-aggregate-error` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |

## Already restored to current master

Current `master` now includes these foundational pieces:

- `docs/router-coordinator-architecture.md`
- `docs/architecture-recovery-index.md`
- `docs/coordinator-runtime-extraction-plan.md`
- `src/intelligence/modelRoles.ts`
- `src/intelligence/edge/edgeProviderPlanner.ts`
- `src/intelligence/edge/edgeProviderPlanner.test.ts`
- `src/runtime/routerCoordinatorContract.ts`
- `src/runtime/routerCoordinatorContract.test.ts`
- `src/runtime/routerCoordinatorDiagnostics.ts`
- `src/runtime/routerCoordinatorDiagnostics.test.ts`
- `src/runtime/routerExecutionAdapter.ts`
- `src/runtime/routerExecutionAdapter.test.ts`
- `src/runtime/prompts/routerPrompt.ts`
- `src/runtime/prompts/coordinatorPrompt.ts`
- `src/runtime/prompts/promptSchemas.ts`
- `src/runtime/prompts/promptJsonSchemas.ts`
- `src/runtime/prompts/promptRegistry.ts`
- `src/runtime/prompts/promptRegistry.test.ts` (covers the router/coordinator prompt registry, prompt schemas, and JSON Schema exports)
- `src/runtime/functionGemmaRouterInvoker.ts`
- `src/runtime/functionGemmaRouterInvoker.test.ts`
- `src/runtime/functionGemmaLocalRuntime.ts`
- `src/runtime/functionGemmaLocalRuntime.test.ts`
- `src/runtime/enhancerQualityFallback.ts`
- `src/runtime/enhancerQualityFallback.test.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.test.ts`
- `src/runtime/interpolatorWriterEvalContract.ts`
- `src/runtime/interpolatorWriterEvalContract.test.ts`
- `src/runtime/interpolatorWriterPromptContract.ts`
- `src/runtime/interpolatorWriterPromptContract.test.ts`
- `src/runtime/interpolatorWriterOutputAdapter.ts`
- `src/runtime/interpolatorWriterOutputAdapter.test.ts`
- `src/runtime/interpolatorWriterFallbackController.ts`
- `src/runtime/interpolatorWriterFallbackController.test.ts`
- `src/runtime/interpolatorWriterExecutionFinalizer.ts`
- `src/runtime/interpolatorWriterExecutionFinalizer.test.ts`
- `src/runtime/interpolatorWriterEvalHarness.ts`
- `src/runtime/interpolatorWriterEvalHarness.test.ts`
- `src/conversation/coordinatorRuntime.ts`
- `src/conversation/coordinatorRuntime.test.ts`
- `src/conversation/coordinatorSourceGuards.ts`
- `src/conversation/coordinatorSourceGuards.test.ts`
- `src/conversation/coordinatorModelStagePlanner.ts`
- `src/conversation/coordinatorModelStagePlanner.test.ts`
- `src/conversation/coordinatorMediaStageExecutor.ts`
- `src/conversation/coordinatorMediaStageExecutor.test.ts`
- `src/conversation/coordinatorWriterStageExecutor.ts`
- `src/conversation/coordinatorWriterStageExecutor.test.ts`
- `src/conversation/coordinatorPremiumStageExecutor.ts`
- `src/conversation/coordinatorPremiumStageExecutor.test.ts`

## Safe recovery order

1. [DONE] Router/coordinator contract and diagnostics refinements.
2. [DONE] FunctionGemma router invoker boundary, execution adapter, local runtime, enhancer quality fallback, and load-error fixes.
3. [DONE] Interpolator writer routing/eval/prompt contracts and baseline output adapter.
4. [DONE] Router runtime adapter / local runtime audit.
5. [DONE] Router/coordinator prompt and authority/advisory profile inspection.
6. [DONE] Router/coordinator shadow evaluator and diagnostics UI inspection.
7. [DONE] Interpolator writer output-adapter review inspection.
8. [DONE] Interpolator writer fallback controller.
9. [DONE] Interpolator writer execution finalizer.
10. [DONE] Interpolator writer eval harness and fixture fixes.
11. [IN PROGRESS] Coordinator runtime extraction around `sessionAssembler.ts`; extracted slices remain additive, and runtime integration is now underway: source-token guard decisions, coordinator context snapshot diagnostics, model-stage planner run/skip gating, media stage executor delegation, writer stage executor delegation, and premium stage executor delegation are integrated (`coordinatorMediaStageExecutor`, `coordinatorWriterStageExecutor`, and `coordinatorPremiumStageExecutor` now own plan/execute and validation/normalization respectively). Final hydration-only collapse (item 7) still pending. Notes: writer delegation introduces defensive shape validation, empty-summary rejection, and bounded normalization (collapsedSummary ≤1.2k, expandedSummary ≤4k, whatChanged ≤8 entries, contributorBlurbs deduped); premium delegation runs with `retryPolicy.maxAttempts: 1` to avoid stacking on the existing inner retry inside `callPremiumDeepInterpolator`. Follow `docs/coordinator-runtime-extraction-plan.md` for the next slices.
12. Expand Cloudflare Workers AI provider support only after router/coordinator/writer contracts remain stable.

## Preflight checklist for future PRs

Use this checklist before opening a major intelligence PR:

- [ ] Search branch names for the feature area.
- [ ] Search code for existing contracts/types/tests.
- [ ] Compare relevant branches against `master`.
- [ ] Identify whether the work is contract, runtime, UI, diagnostics, or provider integration.
- [ ] Recover contract/test slices before runtime wiring.
- [ ] Avoid broad file rewrites unless required.
- [ ] Preserve strict privacy boundaries: no provider secrets in browser code.
- [ ] Preserve local-only privacy behavior.
- [ ] Preserve source-token/staleness checks for async output.
- [ ] Run full CI before merge.

## Notes

Do not treat missing current-master implementation as absence of prior design. This repo has staged architecture branches that may contain authoritative source material. Recovery work should be explicit, audited, and narrow.
