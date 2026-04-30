# Browser ML safety policy

Paper's intelligence architecture is layered. The browser may run small deterministic or lightweight local helpers, but it must not automatically load the full local model stack during normal app use.

## Defaults

The default browser path is conservative:

- Composer guidance starts with deterministic heuristics.
- Server/API-backed writer lanes handle heavier synthesis.
- Browser ML smoke checks are disabled by default.
- Automatic composer ONNX model refinement is disabled by default.
- The default browser model download profile installs only the embeddings model.

## Opt-in flags

Set these only when intentionally testing local browser ONNX behavior:

```bash
VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML=1
VITE_ENABLE_BROWSER_ML_SMOKE=1
```

`VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML=1` only permits the automatic composer model stage on non-mobile devices with at least 8 GiB of reported device memory. Mobile and lower-memory devices remain heuristic/server-backed even when the flag is set.

`VITE_ENABLE_BROWSER_ML_SMOKE=1` starts the browser inference worker during bootstrap diagnostics. Keep this disabled during normal development when investigating memory or crash reports.

## Model staging profiles

Use explicit profiles when downloading browser model assets:

```bash
pnpm models:download-browser              # core: embeddings only
pnpm models:download-browser -- --profile composer_ml
pnpm models:download-browser -- --profile media
pnpm models:download-browser -- --profile balanced
pnpm models:download-browser -- --profile premium
```

Profile intent:

- `core`: embeddings only; safe default for normal development.
- `composer_ml`: tone, toxicity, and sentiment classifiers for explicit composer ML experiments.
- `media`: image captioning only.
- `balanced`: embeddings plus composer classifiers; no 2B/3B local generation models.
- `premium`: explicit experimental staging for large browser model work.

Do not use `premium` as a normal setup step. It can stage multi-GB model assets and may create large browser/dev-server cache usage.

## Why this exists

A previous composer path could trigger multiple browser ONNX model loads from ordinary typing after a short debounce. That violated the intended architecture and could create severe memory pressure or browser crashes. The current gate keeps automatic composer refinement off unless a developer explicitly opts in on a high-memory desktop path.
