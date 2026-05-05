# AI Architecture Live Scorecard

Generated: 2026-05-05
Workspace: /Users/damonoutlaw/paper-atproto

## Scope

This run captures current live architecture quality across:
- Router + coordinator contracts
- Writer model quality
- Multimodal ML quality (sample and remote datasets)
- Strict architecture quality gate
- Local model inventory

## Summary

- FunctionGemma router contract behavior: PASS
- Workers AI coordinator routing assertions: PASS
- Writer quality baseline (local): good but not perfect on one fixture cluster (19/21)
- Multimodal sample dataset: strong (F1 0.9474, fallback 0)
- Multimodal remote dataset: degraded by remote fetch/fallback behavior (F1 0.3077, fallback 0.8333)
- Strict architecture gate: currently FAIL on multimodal F1 threshold in latest strict run (0.7368 vs 0.75)

## Router + Coordinator

Command:

```bash
pnpm run quality:router
```

Key outcomes:
- Media analysis lane uses Cloudflare Workers AI edge plan.
- Media edge endpoint is `/api/edge/media-classify`.
- Text generation contract default route is `model:phi4_mini`.
- Workers AI route is present and allowed in contract (`edge:workers-ai`).
- Multimodal contract includes Workers AI fallback.

## Writer Quality

Command:

```bash
pnpm run quality:local-writers -- --workers-ai --openrouter --json
```

Results:
- Local writer candidate evaluated: `phi4-mini:latest`
  - Passed: 19/21
  - Errors: 0
- Workers AI credentialed comparison: NOT RUN (credentials missing)
  - Missing: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`
- OpenRouter credentialed comparison: NOT RUN (credentials missing)
  - Missing: `OPENROUTER_API_KEY`

## Multimodal ML Quality

### Sample dataset
Command:

```bash
pnpm run eval:multimodal -- --dataset scripts/multimodal_eval_set.sample.jsonl
```

- Precision: 1.0000
- Recall: 0.9000
- F1: 0.9474
- Fallback rate: 0.0000

### Remote dataset
Command:

```bash
pnpm run eval:multimodal -- --dataset scripts/multimodal_eval_set.remote.jsonl
```

- Successful: 6/6
- Analyzed: 1/6
- Fallbacks: 5/6
- Precision: 0.6667
- Recall: 0.2000
- F1: 0.3077
- Fallback rate: 0.8333

Interpretation:
- Core model behavior looks good when full analysis runs.
- Remote URL path currently triggers frequent degraded fallback behavior, heavily impacting aggregate metrics.

## Strict Gate

Command:

```bash
pnpm run quality:architecture:strict
```

Latest run:
- Conversation weighted rate: PASS (1.00 >= 0.99)
- Multimodal precision: PASS (0.7778 >= 0.72)
- Multimodal F1: FAIL (0.7368 < 0.75)
- Multimodal summary contain rate: PASS
- Multimodal fallback rate: PASS
- Premium local-shipped/gemini/openai: PASS

Overall: FAIL (multimodal F1 threshold)

## Local Runtime Model Inventory

Command:

```bash
ollama list | rg 'phi4-mini|qwen3|llama|stable-code'
```

Installed models:
- `phi4-mini:latest`
- `qwen3-vl:4b-instruct-q4_K_M`
- `stable-code:3b-code-q4_0`
- `llama3.2:latest`

## Immediate Follow-up

1. Address remote multimodal fallback root causes (fetch/safe-browsing/URL accessibility path).
2. Re-run strict gate after remote multimodal fallback reductions.
3. Re-run Workers AI/OpenRouter writer comparisons once credentials are provided.

## Live Tunnel Session (Updated)

Active public URL during this run:

- `https://crossing-gary-weblogs-puts.trycloudflare.com`

Tunnel smoke checks:

- `GET /` -> `200`
- `GET /api/llm/admin/diagnostics` -> `200`

### Credentialed provider comparison attempt

Command:

```bash
pnpm run quality:local-writers -- --workers-ai --openrouter --json
```

Observed outcomes:

- Local writer (`phi4-mini:latest`): `20/21`, `0` errors
- Workers AI candidates:
  - All returned `Authentication error status=401 code=10000`
  - Effective score: `0/0` with fixture errors (auth blocked)
- OpenRouter candidates:
  - All returned `402 Insufficient credits`
  - Effective score: `0/0` with fixture errors (billing/credits blocked)

Interpretation:

- The live architecture path is operational (app + API + tunnel).
- Provider-side credential/account state prevented hosted comparative scoring in this run.

### Cloudflare credential retry (successful auth)

Command:

```bash
pnpm run quality:local-writers -- --workers-ai-only --json
```

Credential context used:

- `CF_ACCOUNT_ID` / `CLOUDFLARE_ACCOUNT_ID` set
- `CF_API_TOKEN` / `CLOUDFLARE_API_TOKEN` set

Results:

- `workers_ai_llama32_3b`: `17/21` (best Workers AI candidate in this run)
- `workers_ai_llama31_8b`: `6/21`
- `workers_ai_llama32_1b`: `0/0` scored, blocked by provider schema capability error
  - `Ai: This model doesn't support JSON Schema (status=403, code=5025)`

Conclusion:

- Cloudflare authentication is now working.
- Remaining Workers AI issue is model capability compatibility for the 1B candidate, not auth.

### Live app interpolator regression check (Qwen3 verbatim concern)

Live target:

- `https://crossing-gary-weblogs-puts.trycloudflare.com`

Run 1 (live API fixture eval):

```bash
pnpm run eval:premium-providers -- --base-url https://crossing-gary-weblogs-puts.trycloudflare.com --targets local-shipped,local-raw --json
```

Results:

- `local-shipped`: `21/21`
- `local-raw`: `19/21`

Observed raw-path misses were quality-shape regressions (`no_trailing_ellipsis`, evidence-gap phrasing), not direct quote-copying.

Run 2 (direct live endpoint anti-verbatim probe):

```bash
node --import tsx <<'NODE'
import { PREMIUM_PROVIDER_EVAL_FIXTURES } from './src/evals/premiumProviderFixtures.ts';
// POST each fixture to /api/llm/write/interpolator and detect copied source sentences in collapsedSummary
NODE
```

Per-fixture live outcomes:

- `sparse-skeptical-claim`: `status=200`, `copiedSentenceCount=0`
- `memo-closure-correction`: `status=200`, `copiedSentenceCount=0`
- `policy-pause-with-counterpoint`: `status=200`, `copiedSentenceCount=0`

Conclusion:

- Live interpolator endpoint currently does not exhibit the prior verbatim-copy regression on this fixture set.
- Shipped local path remains stronger and more consistent than raw local path in live execution.

### Expanded live anti-verbatim stress probe

Method:

- Built 12 live requests from the 3 premium fixtures using 4 variants each: `base`, `quote-chain`, `long-root`, and `repeat-bait`.
- Added retry/backoff for `429` responses.
- Checked for direct copied source sentences and 8-token n-gram overlap in `collapsedSummary`.

Result:

- Total attempted: `12`
- `status=200`: `6`
- Potential verbatim cases: `0`

Interpretation:

- The live interpolator continues to avoid direct copy behavior on successful responses, including quote-chain/repetition stress variants.
- Remaining non-200 requests were rate-limit constrained rather than quality regressions.

### Sensitive media UX fixes (implemented)

Addressed issues:

- Repeated click now toggles sensitive media visibility directly on the media surface:
  - first click on blurred media reveals
  - next click hides again
- Removed the disruptive fallback warning state when multimodal moderation is temporarily unavailable.

Files updated:

- `src/components/PostCard.tsx`
- `src/lib/moderation/sensitiveMedia.ts`
- `src/lib/moderation/sensitiveMedia.test.ts`
