#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from setfit import SetFitModel
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

QUALITY_LABELS = [
    "constructive",
    "supportive",
    "clarifying",
    "dismissive",
    "hostile",
    "escalating",
]
TRAINING_BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
RUNTIME_BASE_MODEL = "Xenova/all-MiniLM-L6-v2"
MODEL_ID = "local/composer-quality-setfit-head"
OUTPUT_RELATIVE_PATH = Path("public/models/local/composer-quality-setfit-head/model.json")
DATASET_RELATIVE_PATH = Path("scripts/composer_quality_seed.jsonl")


def load_dataset(path: Path) -> tuple[list[str], list[str]]:
    texts: list[str] = []
    labels: list[str] = []

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        text = str(row["text"]).strip()
        label = str(row["label"]).strip()
        if not text:
            continue
        if label not in QUALITY_LABELS:
            raise ValueError(f"Unexpected label in seed dataset: {label}")
        texts.append(text)
        labels.append(label)

    if not texts:
        raise ValueError("Seed dataset is empty")

    return texts, labels


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    dataset_path = root / DATASET_RELATIVE_PATH
    output_path = root / OUTPUT_RELATIVE_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)

    texts, labels = load_dataset(dataset_path)

    model = SetFitModel.from_pretrained(TRAINING_BASE_MODEL)
    embeddings = model.model_body.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    embeddings = np.asarray(embeddings, dtype="float64")

    classifier = LogisticRegression(
        max_iter=4000,
        solver="lbfgs",
    )
    classifier.fit(embeddings, labels)

    predictions = classifier.predict(embeddings)
    accuracy = accuracy_score(labels, predictions)

    payload = {
        "model": MODEL_ID,
        "provider": "setfit-linear-head",
        "training_base_model": TRAINING_BASE_MODEL,
        "base_model": RUNTIME_BASE_MODEL,
        "normalize_embeddings": True,
        "labels": classifier.classes_.tolist(),
        "coefficients": classifier.coef_.tolist(),
        "intercepts": classifier.intercept_.tolist(),
        "training_examples": len(texts),
        "seed_dataset": str(DATASET_RELATIVE_PATH),
        "training_accuracy": accuracy,
    }
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(f"Exported SetFit-compatible composer quality head to {output_path}")
    print(f"Training examples: {len(texts)}")
    print(f"Seed-set accuracy: {accuracy:.3f}")


if __name__ == "__main__":
    main()
