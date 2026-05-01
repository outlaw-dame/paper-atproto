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
| `fix/interpolator-writer-output-adapter-review` | Diverged review/fix branch with small adapter/test refinements still ahead of `master`. | Inspect in a focused PR before fallback-controller recovery. |
| `feat/interpolator-writer-fallback-controller` | Diverged branch, ahead of `master`, adds fallback controller and tests. | Recover after output-adapter review refinements. |
| `feat/interpolator-writer-execution-finalizer` | Diverged branch, ahead of `master`, adds execution finalizer and tests. | Recover after fallback controller. |
| `feat/interpolator-writer-eval-harness` | Diverged branch for eval harness. | Recover after finalizer. |
| `fix/interpolator-writer-eval-harness-fixture-test` | Follow-up test/fix branch for eval harness. | Inspect alongside eval-harness recovery. |

### Router and coordinator chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/router-coordinator-contract` | Foundational contract and diagnostics work is merged; diagnostic/test refinements remain ahead of `master`. | Review and recover remaining diagnostics only. |
| `feat/router-coordinator-prompts` | Router/coordinator prompt work. | Inspect after remaining diagnostics are reconciled. |
| `feat/router-authority-advisory-profile` | Router authority/advisory profile work. | Inspect with router policy work. |
| `feat/router-runtime-adapter` | Foundational local runtime work is merged; compare before further recovery to identify any remaining runtime-boundary deltas. | Audit before shadow-evaluator work. |
| `feat/router-coordinator-shadow-evaluator` | Shadow evaluation branch. | Recover after runtime adapter audit. |
| `feat/router-coordinator-shadow-diagnostics` | Shadow diagnostics branch. | Recover after shadow evaluator. |
| `feat/router-coordinator-diagnostics-ui` | Diagnostics UI branch. | Recover after diagnostics contracts stabilize. |
| `fix/router-coordinator-route-diagnostics` | Route diagnostics fix branch. | Inspect with diagnostics work. |
| `fix/land-router-runtime-boundary` | Landing/fix branch for router runtime boundary. | Inspect before runtime adapter changes. |

### FunctionGemma router chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/functiongemma-router-invoker-boundary` | Foundational invoker, execution adapter, local runtime, and FunctionGemma tests are merged; enhancer fallback logic from this branch family still needs audit. | Recover remaining enhancer/fallback logic only after auditing current `master`. |
| `fix/functiongemma-load-errors` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |
| `fix/functiongemma-load-error-reporting` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |
| `fix/functiongemma-load-aggregate-error` | Fully absorbed into `master` with zero commits ahead. | Keep as historical source material. |

## Already restored to current master

Current `master` now includes these foundational pieces:

- `docs/router-coordinator-architecture.md`
- `docs/architecture-recovery-index.md`
- `src/intelligence/modelRoles.ts`
- `src/intelligence/edge/edgeProviderPlanner.ts`
- `src/intelligence/edge/edgeProviderPlanner.test.ts`
- `src/runtime/routerCoordinatorContract.ts`
- `src/runtime/routerCoordinatorContract.test.ts`
- `src/runtime/routerCoordinatorDiagnostics.ts`
- `src/runtime/routerCoordinatorDiagnostics.test.ts`
- `src/runtime/routerExecutionAdapter.ts`
- `src/runtime/routerExecutionAdapter.test.ts`
- `src/runtime/functionGemmaRouterInvoker.ts`
- `src/runtime/functionGemmaRouterInvoker.test.ts`
- `src/runtime/functionGemmaLocalRuntime.ts`
- `src/runtime/functionGemmaLocalRuntime.test.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.test.ts`
- `src/runtime/interpolatorWriterEvalContract.ts`
- `src/runtime/interpolatorWriterEvalContract.test.ts`
- `src/runtime/interpolatorWriterPromptContract.ts`
- `src/runtime/interpolatorWriterPromptContract.test.ts`
- `src/runtime/interpolatorWriterOutputAdapter.ts`
- `src/runtime/interpolatorWriterOutputAdapter.test.ts`

## Safe recovery order

1. [DONE] Router/coordinator contract and baseline diagnostics contract.
2. [DONE] FunctionGemma router invoker boundary, execution adapter, local runtime, and load-error fixes.
3. [DONE] Interpolator writer routing/eval/prompt contracts and baseline output adapter.
4. Review and recover remaining router/coordinator diagnostics refinements.
5. Audit router runtime adapter / local runtime branches for any remaining deltas not already on `master`.
6. Recover router/coordinator shadow evaluator and diagnostics.
7. Review and recover `fix/interpolator-writer-output-adapter-review` refinements.
8. Recover interpolator writer fallback controller.
9. Recover interpolator writer execution finalizer.
10. Recover interpolator writer eval harness and fixture fixes.
11. Extract coordinator runtime around `sessionAssembler.ts`.
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
