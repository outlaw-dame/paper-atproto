#!/usr/bin/env bash
set -euo pipefail

# Downloads and converts translation models for CTranslate2 runtime.
# Required tools:
#   - python3
#   - huggingface_hub (pip)
#   - ctranslate2 converters (pip install ctranslate2 sentencepiece transformers)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${ROOT_DIR}/models/translation"
M2M_REPO="facebook/m2m100_418M"

HOT_MARIAN_REPOS=(
  "Helsinki-NLP/opus-mt-en-es"
  "Helsinki-NLP/opus-mt-es-en"
  "Helsinki-NLP/opus-mt-en-fr"
  "Helsinki-NLP/opus-mt-fr-en"
  "Helsinki-NLP/opus-mt-en-de"
  "Helsinki-NLP/opus-mt-de-en"
  "Helsinki-NLP/opus-mt-en-ROMANCE"
  "Helsinki-NLP/opus-mt-ROMANCE-en"
  "Helsinki-NLP/opus-mt-en-jap"
  "Helsinki-NLP/opus-mt-jap-en"
)

mkdir -p "${MODELS_DIR}/hf" "${MODELS_DIR}/ct2"

echo "[translation-models] downloading M2M100 source model..."
python3 -m huggingface_hub.commands.huggingface_cli download "${M2M_REPO}" --local-dir "${MODELS_DIR}/hf/m2m100_418M" --local-dir-use-symlinks False

echo "[translation-models] converting M2M100 to CTranslate2 int8..."
python3 -m ctranslate2.converters.transformers \
  --model "${MODELS_DIR}/hf/m2m100_418M" \
  --output_dir "${MODELS_DIR}/ct2/m2m100_418M_int8" \
  --force \
  --quantization int8

for repo in "${HOT_MARIAN_REPOS[@]}"; do
  short_name="${repo##*/}"
  target_hf="${MODELS_DIR}/hf/${short_name}"
  target_ct2="${MODELS_DIR}/ct2/${short_name}_int8"

  echo "[translation-models] downloading ${repo}..."
  python3 -m huggingface_hub.commands.huggingface_cli download "${repo}" --local-dir "${target_hf}" --local-dir-use-symlinks False

  echo "[translation-models] converting ${repo} to CTranslate2 int8..."
  python3 -m ctranslate2.converters.transformers \
    --model "${target_hf}" \
    --output_dir "${target_ct2}" \
    --force \
    --quantization int8

done

echo "[translation-models] done. Models stored in ${MODELS_DIR}."
