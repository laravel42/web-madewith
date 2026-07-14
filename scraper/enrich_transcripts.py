#!/usr/bin/env python3
"""Turn raw YouTube captions into the published transcript v2 JSON schema.

Raw caption files live in scraper/data/transcripts/<videoId>.json. Published,
AI-structured files live in src/data/transcripts/<videoId>.json.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "scraper" / "data" / "transcripts"
OUT_DIR = ROOT / "src" / "data" / "transcripts"


def clock(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def timestamped_source(raw: dict[str, Any]) -> str:
    return "\n".join(
        f"[{clock(float(segment['start']))}] {str(segment['text']).strip()}"
        for segment in raw.get("segments", [])
        if str(segment.get("text", "")).strip()
    )


def parse_model_json(raw: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    result = json.loads(cleaned)
    if not isinstance(result, dict):
        raise ValueError("Model output must be a JSON object")
    return result


def normalize_result(raw: dict[str, Any], generated: dict[str, Any], duration_seconds: float) -> dict[str, Any]:
    chapters = generated.get("chapters")
    summary = generated.get("summary")
    transcription = generated.get("transcription")
    if not isinstance(chapters, list) or not chapters:
        raise ValueError("chapters must be a non-empty array")
    if not isinstance(summary, str) or len(summary.strip()) < 20:
        raise ValueError("summary must be meaningful Markdown")
    if not isinstance(transcription, str) or len(transcription.strip()) < 20:
        raise ValueError("transcription must be meaningful Markdown")

    normalized: list[dict[str, Any]] = []
    previous_end = 0.0
    for index, chapter in enumerate(chapters):
        if not isinstance(chapter, dict):
            raise ValueError(f"chapter {index} must be an object")
        title = str(chapter.get("title", "")).strip()
        description = str(chapter.get("description", "")).strip()
        try:
            start = float(chapter["startTime"])
            end = float(chapter["endTime"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"chapter {index} requires numeric startTime and endTime") from exc
        if not title or not description:
            raise ValueError(f"chapter {index} requires title and description")
        if start < 0 or end <= start:
            raise ValueError(f"chapter {index} endTime must be greater than startTime")
        if start < previous_end - 1:
            raise ValueError(f"chapter {index} overlaps the previous chapter")
        normalized.append({
            "title": title,
            "description": description,
            "startTime": round(start, 3),
            "endTime": round(min(end, duration_seconds), 3),
        })
        previous_end = end

    if normalized[-1]["startTime"] >= duration_seconds:
        raise ValueError("final chapter starts after the video ends")
    normalized[-1]["endTime"] = round(duration_seconds, 3)

    return {
        "schemaVersion": 2,
        "videoId": str(raw["videoId"]),
        "language": str(raw.get("language") or "unknown"),
        "source": str(raw.get("source") or "unknown"),
        "chapters": normalized,
        "summary": summary.strip(),
        "transcription": transcription.strip(),
    }


def prompt_for(raw: dict[str, Any], title: str, duration_seconds: float) -> str:
    return f"""You are an expert transcript editor. Return JSON only, with exactly these keys:
{{
  "chapters": [{{"title": "Meaningful chapter title", "description": "What is taught or argued in this chapter.", "startTime": 0, "endTime": 60.5}}],
  "summary": "Markdown summary",
  "transcription": "Structured Markdown transcript"
}}

Requirements:
- Chapters divide the entire video into coherent argument/topic chunks in chronological order.
- Every chapter needs a specific AI-written title and useful one- or two-sentence description.
- startTime and endTime are numeric seconds. Cover the full {duration_seconds:.3f}-second runtime without overlaps.
- summary is a concise Markdown résumé of the video's most relevant concepts, decisions, examples, and takeaways. Do not add facts absent from the speech.
- transcription is the literal speech-to-text content, reorganized as readable Markdown with headings and paragraphs. Preserve every substantive claim, instruction, example, warning, and conclusion. Fix punctuation, capitalization, paragraph breaks, and obvious caption mistakes, but do not summarize, invent, or silently omit content.
- Remove only non-speech caption noise such as isolated [Music] markers and accidental duplicated fragments.

Video title: {title}
Video ID: {raw['videoId']}
Language: {raw.get('language', 'unknown')}

TIMESTAMPED RAW CAPTIONS
{timestamped_source(raw)}
""".strip()


def generate(client: Any, model: str, prompt: str) -> dict[str, Any]:
    for attempt in range(5):
        try:
            response = client.responses.create(model=model, input=prompt)
            return parse_model_json(response.output_text)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError("unreachable")


def metadata() -> dict[str, tuple[str, float]]:
    import psycopg

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("SELECT youtube_video_id, title, COALESCE(duration_seconds, 0) FROM youtube_videos")
        return {video_id: (title, float(duration)) for video_id, title, duration in cur.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(RAW_DIR), help="Raw-caption directory")
    parser.add_argument("--out", default=str(OUT_DIR), help="Published transcript directory")
    parser.add_argument("--video-id", help="Process one YouTube video ID")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--model", help="OpenAI model; defaults to OPENAI_MODEL or gpt-5-mini")
    parser.add_argument("--force", action="store_true", help="Replace an existing v2 output")
    parser.add_argument("--dry-run", action="store_true", help="Validate inputs without calling OpenAI")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    input_dir, out_dir = Path(args.input), Path(args.out)
    candidates = sorted(input_dir.glob("*.json"))
    if args.video_id:
        candidates = [input_dir / f"{args.video_id}.json"]
    candidates = [path for path in candidates if path.exists()][:args.limit]
    if args.dry_run:
        for path in candidates:
            raw = json.loads(path.read_text())
            print(f"{raw['videoId']}: {len(raw.get('segments', []))} segments")
        return 0
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required")

    from openai import OpenAI

    info = metadata()
    model = args.model or os.getenv("OPENAI_MODEL", "gpt-5-mini")
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    out_dir.mkdir(parents=True, exist_ok=True)
    written = skipped = failed = 0
    for index, path in enumerate(candidates, 1):
        raw = json.loads(path.read_text())
        video_id = str(raw["videoId"])
        output = out_dir / f"{video_id}.json"
        if output.exists() and not args.force:
            try:
                if json.loads(output.read_text()).get("schemaVersion") == 2:
                    skipped += 1
                    print(f"[{index}/{len(candidates)}] {video_id} skip (v2 exists)")
                    continue
            except (OSError, json.JSONDecodeError):
                pass
        title, db_duration = info.get(video_id, (video_id, 0.0))
        segments = raw.get("segments", [])
        inferred_duration = float(segments[-1]["start"]) + 5 if segments else 0.0
        duration = max(db_duration, inferred_duration)
        try:
            generated = generate(client, model, prompt_for(raw, title, duration))
            result = normalize_result(raw, generated, duration)
            output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
            written += 1
            print(f"[{index}/{len(candidates)}] {video_id} ok ({len(result['chapters'])} chapters)")
        except Exception as exc:
            failed += 1
            print(f"[{index}/{len(candidates)}] {video_id} FAIL {type(exc).__name__}: {exc}")
    print(f"Done — written={written} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
