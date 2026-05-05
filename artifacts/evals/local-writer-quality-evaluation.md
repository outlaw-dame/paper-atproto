# Local Writer Quality Evaluation

Generated: 2026-05-05 01:09 local time
Updated: 2026-05-05 Phi-4 mini local writer promotion

## Scope

This evaluation compares local Interpolator writer candidates using the same server-side writer prompt, validator, and fixture expectations. Remote/API enhancers are disabled for this measurement so scores reflect raw local writer quality.

Command used:

```bash
pnpm run quality:local-writers -- --models gemma4:e2b,gemma4:e4b --json
```

Architecture contract check:

```bash
pnpm run quality:router
```

## Local Model Inventory

Installed Ollama models at evaluation time:

| Model | Role |
| --- | --- |
| `phi4-mini:latest` | Text writer candidate, promoted default after local eval |
| `qwen3:4b-instruct-2507-q4_K_M` | Former text writer baseline, lower score than Phi-4 mini; removed after promotion |
| `qwen3-vl:4b-instruct-q4_K_M` | Vision/multimodal, excluded from text-writer scoring |
| `stable-code:3b-code-q4_0` | Code model, excluded from Interpolator writer scoring |
| `llama3.2:latest` | General text model, not part of the configured writer contract |

Gemma writer tags were not installed locally. Explicit attempts to score `gemma4:e2b` and `gemma4:e4b` returned `Ollama responded 404` for every fixture.

## Scoring Method

Each writer candidate is evaluated across three conversation fixtures. Every fixture has seven checks:

- summary is present
- summary is a complete sentence
- summary has no trailing ellipsis
- summary avoids generic scaffolding
- required participant handles are mentioned
- topic signal usage meets the fixture threshold
- evidence or evidence-gap language appears as required

Total possible score per model: 21 checks.

## Results

| Candidate | Availability | Passed | Total | Rate | Errors | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Phi-4 mini `phi4-mini:latest` | Available | 20 | 21 | 0.9524 | 0 | Promoted local writer default |
| Qwen3 4B `qwen3:4b-instruct-2507-q4_K_M` | Previously available | 17 | 21 | 0.8095 | 0 | Historical measured baseline |
| Gemma 4 E2B `gemma4:e2b` | Missing from Ollama | 0 | 0 | N/A | 3 | Not quality-measurable yet |
| Gemma 4 E4B `gemma4:e4b` | Missing from Ollama | 0 | 0 | N/A | 3 | Not quality-measurable yet |

## Phi-4 Mini Quality Findings

Phi-4 mini was installed through Ollama with no Hugging Face token and evaluated using the same local writer harness:

```bash
pnpm run quality:local-writers -- --models phi4-mini:latest
```

Head-to-head result: `phi4-mini:latest` scored `20/21` with `0` runtime errors. The only missed check was `no_trailing_ellipsis`. In the same run, Qwen3 scored `17/21` with misses on `no_trailing_ellipsis` and participant coverage. Because Phi-4 mini is the same local storage class as Qwen3 (`2.5 GB`) and scored higher, it is now the preferred local Ollama writer default.

Post-promotion verification after deleting the Qwen3 text model scored `21/21` with `0` runtime errors, and the local writer harness discovered only `phi4-mini:latest` as the text writer candidate.

## Qwen3 Quality Findings

Qwen3 produced grounded, useful summaries across all three fixtures, with no runtime errors. It passed all topic-signal and evidence-language checks.

Observed misses:

- `sparse-skeptical-claim`: missed `no_trailing_ellipsis` and under-mentioned required participants (`1/2`).
- `memo-closure-correction`: under-mentioned required participants (`2/3`).
- `policy-pause-with-counterpoint`: under-mentioned required participants (`2/3`).

Quality interpretation: Qwen3 is usable as the current local writer baseline, but raw output still benefits from the contributor coverage guard and/or enhancer review because it tends to preserve contributor details in expanded context rather than always naming enough participants in the primary summary.

## Gemma Quality Findings

Gemma cannot be assigned a quality score in this environment yet because neither configured Gemma candidate is available to Ollama:

- `gemma4:e2b`: 3/3 fixture executions failed with `Ollama responded 404`.
- `gemma4:e4b`: 3/3 fixture executions failed with `Ollama responded 404`.

This is an availability failure, not a quality failure. Gemma remains a planned/local-configurable writer candidate, and the evaluation harness can score it once the local runtime has a matching tag. It should not be treated as an executable fallback route until that binding exists.

## Workers AI Writer Comparison

Because Gemma is not installed locally, the writer harness now supports Cloudflare Workers AI text models with the same Interpolator prompt, JSON validation, and fixture scoring used for Qwen:

```bash
pnpm run quality:local-writers -- --workers-ai
```

For isolating edge-hosted writers without waiting on local Ollama, use:

```bash
pnpm run quality:local-writers -- --workers-ai-only
```

For larger Workers AI candidates, use:

```bash
pnpm run quality:local-writers -- --workers-ai-only --workers-ai-large
```

Selected Workers AI writer candidates:

| Candidate | Why selected | Current availability |
| --- | --- | --- |
| `@cf/meta/llama-3.1-8b-instruct` | Strongest general-purpose Workers AI instruct baseline in this set; closest edge-hosted quality comparator to local Qwen3-4B. | Reachable with provided credentials; supports JSON Schema but scored poorly on the current prompt. |
| `@cf/meta/llama-3.2-1b-instruct` | Smallest latency-oriented Workers AI Llama writer in this set, useful as the edge-speed lower bound against Qwen3 and larger Workers AI models. | Reachable with provided credentials; failed strict JSON parsing on all fixtures. |
| `@cf/meta/llama-3.2-3b-instruct` | Smaller latency-oriented edge writer to measure the quality tradeoff against Qwen3 and larger Workers AI models. | Reachable with provided credentials; best Workers AI quality candidate, but one fixture returned malformed JSON in the final run. |

Live credentialed run result using temporary shell variables only:

| Candidate | Passed | Total | Rate | Errors | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Qwen3 4B `qwen3:4b-instruct-2507-q4_K_M` | 18 | 21 | 0.8571 | 0 | Prior local baseline from the same harness. |
| Workers AI Llama 3.2 3B `@cf/meta/llama-3.2-3b-instruct` | 12 | 14 | 0.8571 | 1 | Best edge writer quality observed; scored `19/21` in an earlier successful JSON-object run, but final adaptive run had one malformed JSON response. |
| Workers AI Llama 3.1 8B `@cf/meta/llama-3.1-8b-instruct` | 6 | 21 | 0.2857 | 0 | Executed reliably with JSON Schema, but returned content that failed many summary-presence and fixture-signal checks. |
| Workers AI Llama 3.2 1B `@cf/meta/llama-3.2-1b-instruct` | 0 | 0 | N/A | 3 | Returned non-JSON/bare-field text instead of valid writer JSON. |

Workers AI schema compatibility findings:

- `@cf/meta/llama-3.1-8b-instruct` rejects `response_format: { type: "json_object" }` with Cloudflare code `9015`, but accepts `json_schema`.
- `@cf/meta/llama-3.2-1b-instruct` and `@cf/meta/llama-3.2-3b-instruct` reject `json_schema` with Cloudflare code `5025`, but can run with `json_object`.
- The harness now retries the alternate structured-output format when Cloudflare reports either incompatibility, and also retries once when a reasoning model returns non-JSON prose that fails strict parsing.

Security note: Cloudflare credentials were entered through masked terminal prompts, exported only for the eval process, and explicitly unset afterward. No credential value is written to this artifact.

Larger Workers AI live credentialed probe:

| Candidate | Why selected | Latest probe result |
| --- | --- | --- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Larger Workers AI Llama family candidate intended to test whether 70B edge inference improves writer quality over Llama 3.2 3B. | Executed with provided credentials and scored `17/21` with no observed parse errors. Fixture scores: `5/7` in `15466ms`, `6/7` in `21302ms`, `6/7` in `15138ms`. |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | Larger reasoning-oriented distilled Qwen model, useful for evidence-gap and counterpoint handling. | Executed with provided credentials after adaptive response-format retry. Captured fixture scores were `6/7` in `14323ms` and `2/7` in `41412ms`; the final fixture did not emit a captured score before the eval terminal exited. Earlier strict parsing failed because the model wrapped JSON in reasoning/prose, not because the model or credentials were unavailable. |
| `@cf/qwen/qwq-32b` | Larger Qwen-family reasoning model to compare against the local Qwen3 writer baseline. | Executed with provided credentials and scored `11/21`: `2/7` in `27253ms`, `2/7` in `33901ms`, and `7/7` in `19920ms`. It is scorable after adaptive retry, but quality is uneven and latency is high. |

Large-model interpretation: Workers AI Llama 3.3 70B is the strongest larger Cloudflare writer measured so far, but it is slower than the smaller 3B edge candidate and still below the best earlier Llama 3.2 3B observation (`19/21`). DeepSeek R1 and QwQ can execute with the supplied credentials, but their reasoning/prose output requires adaptive JSON handling and their latency makes them poor default writer routes unless future prompt tuning materially improves reliability.

Credential cleanup was verified after the latest Workers AI run with no `CF_*`, `CLOUDFLARE_*`, `OPENROUTER_API_KEY`, or `OPENROUTER_TOKEN` variables remaining in the shell environment.

## OpenRouter Writer Comparison

The writer harness now supports OpenRouter models using the same Interpolator prompt, JSON validation, and fixture scoring:

```bash
pnpm run quality:local-writers -- --openrouter-only
```

Default OpenRouter paid-model candidates:

| Candidate | Why selected | Latest probe result |
| --- | --- | --- |
| `openai/gpt-4o-mini` | Fast high-quality hosted baseline with reliable instruction following and JSON output support. | Authenticated, but OpenRouter returned `402 Insufficient credits`. |
| `google/gemini-2.0-flash-001` | Low-latency Google model to compare concise summarization quality against Qwen and Workers AI. | Authenticated, but OpenRouter returned `402 Insufficient credits`. |
| `anthropic/claude-3.5-haiku` | Anthropic small-model writer baseline, useful for grounded summary and safety-sensitive phrasing comparison. | Authenticated, but OpenRouter returned `402 Insufficient credits`. |

Free OpenRouter catalog-verified candidates can be run with:

```bash
pnpm run quality:local-writers -- --openrouter-only --openrouter-free
```

| Candidate | Why selected | Latest probe result |
| --- | --- | --- |
| `meta-llama/llama-3.3-70b-instruct:free` | Large free OpenRouter Llama baseline for checking whether hosted 70B improves Interpolator writing quality. | OpenRouter accepted the model ID, but the provider returned `429`. |
| `qwen/qwen3-next-80b-a3b-instruct:free` | Large free Qwen-family model to compare directly with the local Qwen3 writer baseline. | OpenRouter accepted the model ID, but the provider returned `429`. |
| `google/gemma-4-31b-it:free` | Large free Gemma-family writer candidate to test the Gemma route through OpenRouter while local Gemma is absent. | OpenRouter accepted the model ID, but the provider returned `429` before a score was produced. |

OpenRouter key handling: the API key was entered through a masked terminal prompt, exported only for the eval process, and unset afterward. A follow-up shell check confirmed no `OPENROUTER_API_KEY` or `OPENROUTER_TOKEN` variable remained present.

## Router Contract Verification

`pnpm run quality:router` passed and confirms:

- `model:phi4_mini` is the default text-generation route.
- planned Gemma models are not advertised as executable text-generation fallback routes without an installed/configured runtime binding.
- `edge:workers-ai` remains available as the remote edge fallback route.

## Recommendation

Keep Phi-4 mini as the active local Ollama writer baseline. Qwen3 4B remains useful historically, but it no longer beats the local Phi-4 mini result on the current Interpolator fixtures.

Next validation step after installing/configuring Gemma:

```bash
GEMMA_WRITER_MODELS="<installed-gemma-tag>" pnpm run quality:local-writers
```

Promotion threshold recommendation: Gemma should reach at least Phi-4 mini's current raw baseline of `20/21` with no runtime errors, and it should preserve participant-handle coverage before becoming the preferred local writer.