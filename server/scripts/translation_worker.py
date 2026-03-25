#!/usr/bin/env python3

import json
import os
import sys
import traceback

import ctranslate2
from transformers import AutoTokenizer, M2M100Tokenizer


TRANSLATORS = {}
TOKENIZERS = {}


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_marian(model_dir, hf_dir):
    cache_key = f"marian::{model_dir}::{hf_dir}"
    if cache_key not in TRANSLATORS:
        TRANSLATORS[cache_key] = ctranslate2.Translator(model_dir, device="cpu")
    if cache_key not in TOKENIZERS:
        TOKENIZERS[cache_key] = AutoTokenizer.from_pretrained(hf_dir)
    return TRANSLATORS[cache_key], TOKENIZERS[cache_key]


def load_m2m100(model_dir, hf_dir):
    cache_key = f"m2m100::{model_dir}::{hf_dir}"
    if cache_key not in TRANSLATORS:
        TRANSLATORS[cache_key] = ctranslate2.Translator(model_dir, device="cpu")
    if cache_key not in TOKENIZERS:
        TOKENIZERS[cache_key] = M2M100Tokenizer.from_pretrained(hf_dir)
    return TRANSLATORS[cache_key], TOKENIZERS[cache_key]


def decode_tokens(tokenizer, tokens):
    token_ids = tokenizer.convert_tokens_to_ids(tokens)
    return tokenizer.decode(token_ids, skip_special_tokens=True).strip()


def translate_marian(request):
    translator, tokenizer = load_marian(request["modelDir"], request["hfDir"])
    source_text = request["text"]
    target_prefix = request.get("targetPrefix")
    if target_prefix:
        source_text = f">>{target_prefix}<< {source_text}"

    source_ids = tokenizer.encode(source_text)
    source_tokens = tokenizer.convert_ids_to_tokens(source_ids)
    result = translator.translate_batch([source_tokens], beam_size=4)[0]
    return decode_tokens(tokenizer, result.hypotheses[0])


def translate_m2m100(request):
    translator, tokenizer = load_m2m100(request["modelDir"], request["hfDir"])
    tokenizer.src_lang = request["sourceLang"]
    source_ids = tokenizer.encode(request["text"])
    source_tokens = tokenizer.convert_ids_to_tokens(source_ids)
    target_token = tokenizer.get_lang_token(request["targetLang"])
    result = translator.translate_batch(
        [source_tokens],
        target_prefix=[[target_token]],
        beam_size=4,
    )[0]
    return decode_tokens(tokenizer, result.hypotheses[0])


def handle_request(request):
    provider = request["provider"]
    if provider == "marian":
        return translate_marian(request)
    if provider == "m2m100":
        return translate_m2m100(request)
    raise ValueError(f"Unsupported provider: {provider}")


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request.get("requestId", "unknown")
            translated_text = handle_request(request)
            emit({
                "requestId": request_id,
                "ok": True,
                "translatedText": translated_text,
            })
        except Exception as exc:
            emit({
                "requestId": request.get("requestId", "unknown") if "request" in locals() else "unknown",
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=6),
            })


if __name__ == "__main__":
    main()