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
| `feat/interpolator-writer-output-adapter` | Diverged branch, ahead of `master`, adds `interpolatorWriterOutputAdapter.ts` and tests. | Review and recover next in a focused PR. |
| `fix/interpolator-writer-output-adapter-review` | Review/fix branch for output adapter. | Inspect alongside output-adapter recovery. |
| `feat/interpolator-writer-fallback-controller` | Diverged branch, ahead of `master`, adds fallback controller and tests. | Recover after output adapter. |
| `feat/interpolator-writer-execution-finalizer` | Diverged branch, ahead of `master`, adds execution finalizer and tests. | Recover after fallback controller. |
| `feat/interpolator-writer-eval-harness` | Diverged branch for eval harness. | Recover after finalizer. |
| `fix/interpolator-writer-eval-harness-fixture-test` | Follow-up test/fix branch for eval harness. | Inspect alongside eval-harness recovery. |

### Router and coordinator chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/router-coordinator-contract` | Diverged branch; compare shows diagnostics contract/test changes remain ahead of `master`. | Review and recover before runtime changes. |
| `feat/router-coordinator-prompts` | Router/coordinator prompt work. | Inspect after contract recovery. |
| `feat/router-authority-advisory-profile` | Router authority/advisory profile work. | Inspect with router policy work. |
| `feat/router-runtime-adapter` | Diverged branch, adds FunctionGemma local runtime files and tests. | Recover after router/coordinator contracts. |
| `feat/router-coordinator-shadow-evaluator` | Shadow evaluation branch. | Recover after runtime adapter. |
| `feat/router-coordinator-shadow-diagnostics` | Shadow diagnostics branch. | Recover after shadow evaluator. |
| `feat/router-coordinator-diagnostics-ui` | Diagnostics UI branch. | Recover after diagnostics contracts stabilize. |
| `fix/router-coordinator-route-diagnostics` | Route diagnostics fix branch. | Inspect with diagnostics work. |
| `fix/land-router-runtime-boundary` | Landing/fix branch for router runtime boundary. | Inspect before runtime adapter recovery. |

### FunctionGemma router chain

| Branch | Current assessment | Action |
|---|---|---|
| `feat/functiongemma-router-invoker-boundary` | Diverged branch; adds FunctionGemma invoker, router execution adapter, enhancer fallback, and tests. | High-priority recovery after router/coordinator contracts. |
| `fix/functiongemma-load-errors` | Follow-up load-error fix branch. | Inspect with FunctionGemma recovery. |
| `fix/functiongemma-load-error-reporting` | Follow-up load-error reporting branch. | Inspect with FunctionGemma recovery. |
| `fix/functiongemma-load-aggregate-error` | Follow-up aggregate-error branch. | Inspect with FunctionGemma recovery. |

## Already restored to current master

Current `master` now includes these foundational pieces:

- `docs/router-coordinator-architecture.md`
- `src/intelligence/modelRoles.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.ts`
- `src/runtime/interpolatorWriterRoutingPolicy.test.ts`
- `src/runtime/interpolatorWriterEvalContract.ts`
- `src/runtime/interpolatorWriterEvalContract.test.ts`
- `src/runtime/interpolatorWriterPromptContract.ts`
- `src/runtime/interpolatorWriterPromptContract.test.ts`
- `src/intelligence/edge/edgeProviderPlanner.ts`
- `src/intelligence/edge/edgeProviderPlanner.test.ts`

## Safe recovery order

1. Router/coordinator contract and diagnostics contract.
2. FunctionGemma router invoker boundary and load-error fixes.
3. Router runtime adapter / local runtime boundary.
4. Router/coordinator shadow evaluator and diagnostics.
5. Interpolator writer output adapter and review fixes.
6. Interpolator writer fallback controller.
7. Interpolator writer execution finalizer.
8. Interpolator writer eval harness and fixture fixes.
9. Coordinator runtime extraction around `sessionAssembler.ts`.
10. Broader Cloudflare Workers AI provider expansion after router/coordinator/writer contracts are stable.

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
