#!/usr/bin/env python3

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoConfig, AutoTokenizer


@dataclass(frozen=True)
class ModelSpec:
    source_id: str
    local_id: str
    purpose: str


MODELS = [
    ModelSpec(
        source_id="cardiffnlp/twitter-roberta-base-emotion-latest",
        local_id="cardiffnlp/twitter-roberta-base-emotion-latest-onnx",
        purpose="Composer emotion classification",
    ),
    ModelSpec(
        source_id="cardiffnlp/twitter-roberta-base-topic-sentiment-latest",
        local_id="cardiffnlp/twitter-roberta-base-topic-sentiment-latest-onnx",
        purpose="Composer reply-targeted sentiment",
    ),
]

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "public" / "models"
TEMP_ROOT = ROOT / ".tmp" / "composer-model-exports"


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def find_model_artifact(path: Path) -> Path:
    direct = path / "model.onnx"
    if direct.exists():
        return direct

    nested = path / "onnx" / "model.onnx"
    if nested.exists():
        return nested

    candidates = sorted(path.rglob("*.onnx"))
    if not candidates:
        raise FileNotFoundError(f"No ONNX artifact found under {path}")

    return candidates[0]


def copy_onnx_bundle(model_artifact: Path, output_dir: Path) -> None:
    onnx_dir = output_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    output_model_path = onnx_dir / "model.onnx"
    shutil.copy2(model_artifact, output_model_path)

    for sibling in model_artifact.parent.iterdir():
        if sibling.name == model_artifact.name:
            continue
        if sibling.suffix in {".onnx_data", ".data"} or sibling.name.endswith(".onnx_data"):
            shutil.copy2(sibling, onnx_dir / sibling.name)

    quantize_dynamic(
        model_input=str(output_model_path),
        model_output=str(onnx_dir / "model_quantized.onnx"),
        weight_type=QuantType.QInt8,
    )
    output_model_path.unlink(missing_ok=True)


def export_model(spec: ModelSpec) -> None:
    temp_dir = TEMP_ROOT / spec.local_id.replace("/", "__")
    output_dir = OUTPUT_ROOT / spec.local_id
    ensure_clean_dir(temp_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Exporting {spec.source_id} -> {spec.local_id}")

    AutoTokenizer.from_pretrained(spec.source_id).save_pretrained(output_dir)
    AutoConfig.from_pretrained(spec.source_id).save_pretrained(output_dir)

    export_cmd = [
        sys.executable,
        "-m",
        "optimum.exporters.onnx",
        "--model",
        spec.source_id,
        "--task",
        "text-classification",
        str(temp_dir),
    ]
    subprocess.run(export_cmd, check=True)

    model_artifact = find_model_artifact(temp_dir)
    copy_onnx_bundle(model_artifact, output_dir)

    metadata = {
        "source_id": spec.source_id,
        "local_id": spec.local_id,
        "purpose": spec.purpose,
        "exported_with": "optimum.exporters.onnx",
    }
    (output_dir / "export-metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)

    for spec in MODELS:
        export_model(spec)

    print("\nComposer Cardiff models exported locally:")
    for spec in MODELS:
        print(f"- {spec.local_id}")


if __name__ == "__main__":
    main()
