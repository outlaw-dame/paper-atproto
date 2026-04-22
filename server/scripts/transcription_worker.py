#!/usr/bin/env python3

import json
import os
import sys
import traceback

from faster_whisper import WhisperModel


MODEL = None
MODEL_NAME = None


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_model():
    global MODEL, MODEL_NAME
    if MODEL is not None:
        return MODEL, MODEL_NAME

    model_size = os.environ.get("WHISPER_MODEL_SIZE", "small")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

    MODEL = WhisperModel(model_size, device=device, compute_type=compute_type)
    MODEL_NAME = f"faster-whisper:{model_size}"
    return MODEL, MODEL_NAME


def format_timestamp(seconds):
    safe = max(0.0, float(seconds or 0.0))
    total_ms = int(round(safe * 1000))
    hours = total_ms // 3600000
    minutes = (total_ms % 3600000) // 60000
    secs = (total_ms % 60000) // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def normalize_segments(raw_segments):
    segments = []
    for segment in raw_segments:
        text = (segment.text or "").strip()
        if not text:
            continue
        segments.append({
            "start": float(segment.start or 0.0),
            "end": float(segment.end or 0.0),
            "text": text,
        })
    return segments


def collapse_segments(segments, group_size):
    collapsed = []
    current = []
    for segment in segments:
        current.append(segment)
        if len(current) >= group_size:
            collapsed.append({
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": " ".join(item["text"] for item in current).strip(),
            })
            current = []
    if current:
        collapsed.append({
            "start": current[0]["start"],
            "end": current[-1]["end"],
            "text": " ".join(item["text"] for item in current).strip(),
        })
    return collapsed


def build_vtt(segments):
    lines = ["WEBVTT", ""]
    for index, segment in enumerate(segments, start=1):
      lines.append(str(index))
      lines.append(f"{format_timestamp(segment['start'])} --> {format_timestamp(segment['end'])}")
      lines.append(segment["text"])
      lines.append("")
    return "\n".join(lines).strip() + "\n"


def fit_vtt_within_limit(segments, max_bytes):
    if not segments:
        return "WEBVTT\n\n", []

    working = segments
    for group_size in [1, 2, 3, 4, 6, 8, 12, 16]:
        working = collapse_segments(segments, group_size) if group_size > 1 else segments
        vtt = build_vtt(working)
        if len(vtt.encode("utf-8")) <= max_bytes:
            return vtt, working

    raise ValueError(f"Generated caption track exceeds {max_bytes} bytes; shorten the clip or provide captions manually.")


def transcribe(request):
    model, model_name = get_model()
    language = request.get("language")
    max_vtt_bytes = int(request.get("maxVttBytes") or 20000)
    profile = request.get("profile") or "quality"
    if profile not in {"fast", "quality", "long_form"}:
        profile = "quality"

    if profile == "fast":
        beam_size = 1
        condition_on_previous_text = False
    elif profile == "long_form":
        beam_size = 5
        condition_on_previous_text = True
    else:
        beam_size = 5
        condition_on_previous_text = True

    raw_segments, info = model.transcribe(
        request["filePath"],
        language=language,
        vad_filter=True,
        beam_size=beam_size,
        condition_on_previous_text=condition_on_previous_text,
      )

    segments = normalize_segments(list(raw_segments))
    text = "\n".join(segment["text"] for segment in segments).strip()
    vtt, fitted_segments = fit_vtt_within_limit(segments, max_vtt_bytes)

    return {
        "text": text,
        "vtt": vtt,
        "language": info.language or language or "und",
        "languageProbability": getattr(info, "language_probability", None),
        "durationSeconds": getattr(info, "duration", None),
        "model": model_name,
        "profile": profile,
        "segments": fitted_segments,
    }


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request.get("requestId", "unknown")
            result = transcribe(request)
            emit({
                "requestId": request_id,
                "ok": True,
                "result": result,
            })
        except Exception as exc:
            emit({
                "requestId": request.get("requestId", "unknown") if "request" in locals() else "unknown",
                "ok": False,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=8),
            })


if __name__ == "__main__":
    main()